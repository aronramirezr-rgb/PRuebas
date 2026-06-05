import cgi
import hashlib
import json
import mimetypes
import os
import secrets
import shutil
import sqlite3
import time
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
STORAGE_ROOT = Path(os.environ.get("STORAGE_DIR", ROOT)).resolve()
PUBLIC_DIR = ROOT / "public"
DATA_DIR = STORAGE_ROOT / "data"
UPLOAD_DIR = STORAGE_ROOT / "uploads"
DB_PATH = DATA_DIR / "app.db"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "4173"))
ADMIN_COOKIE = "customforge_admin"
DEFAULT_ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
SESSIONS = {}


def now():
    return int(time.time())


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"{salt}${digest.hex()}"


def verify_password(password, stored):
    try:
        salt, expected = stored.split("$", 1)
    except ValueError:
        return False
    return password_hash(password, salt).split("$", 1)[1] == expected


def init_db():
    DATA_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)
    (UPLOAD_DIR / "products").mkdir(exist_ok=True)
    (UPLOAD_DIR / "tumblers").mkdir(exist_ok=True)
    (UPLOAD_DIR / "thumbs").mkdir(exist_ok=True)

    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS categories (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              slug TEXT NOT NULL UNIQUE,
              sort_order INTEGER NOT NULL DEFAULT 0,
              active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS products (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              category_id INTEGER,
              name TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT '',
              base_price_mxn REAL NOT NULL DEFAULT 0,
              file_path TEXT,
              file_type TEXT NOT NULL DEFAULT 'stl',
              thumbnail_path TEXT,
              active INTEGER NOT NULL DEFAULT 1,
              metadata_json TEXT NOT NULL DEFAULT '{}',
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              FOREIGN KEY(category_id) REFERENCES categories(id)
            );
            CREATE TABLE IF NOT EXISTS tumblers (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              ounces INTEGER NOT NULL,
              has_handle INTEGER NOT NULL DEFAULT 0,
              base_price_mxn REAL NOT NULL DEFAULT 0,
              engraving_price_mxn REAL NOT NULL DEFAULT 45,
              model_path TEXT,
              active INTEGER NOT NULL DEFAULT 1,
              metadata_json TEXT NOT NULL DEFAULT '{}',
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            """
        )

        if not conn.execute("SELECT value FROM settings WHERE key='admin_password_hash'").fetchone():
            conn.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?)",
                ("admin_password_hash", password_hash(DEFAULT_ADMIN_PASSWORD)),
            )
        if not conn.execute("SELECT id FROM categories LIMIT 1").fetchone():
            conn.executemany(
                "INSERT INTO categories(name, slug, sort_order, active) VALUES(?, ?, ?, 1)",
                [
                    ("Llaveros", "llaveros", 1),
                    ("Figuras", "figuras", 2),
                    ("Piezas funcionales", "piezas-funcionales", 3),
                    ("Regalos", "regalos", 4),
                ],
            )
        if not conn.execute("SELECT id FROM tumblers LIMIT 1").fetchone():
            t = now()
            conn.executemany(
                """
                INSERT INTO tumblers(name, ounces, has_handle, base_price_mxn, engraving_price_mxn, created_at, updated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    ("Termo 20 oz", 20, 0, 230, 45, t, t),
                    ("Termo 30 oz", 30, 0, 280, 55, t, t),
                    ("Termo 30 oz con asa", 30, 1, 340, 65, t, t),
                    ("Termo 40 oz", 40, 1, 390, 75, t, t),
                ],
            )


def row_dict(row):
    return dict(row) if row else None


def public_path(path):
    if not path:
        return None
    return "/" + path.replace("\\", "/").lstrip("/")


def category_payload(conn):
    rows = conn.execute(
        "SELECT id, name, slug, sort_order, active FROM categories ORDER BY sort_order, name"
    ).fetchall()
    return [row_dict(row) for row in rows]


def product_payload(conn, include_inactive=False):
    clause = "" if include_inactive else "WHERE p.active=1"
    rows = conn.execute(
        f"""
        SELECT p.*, c.name AS category_name, c.slug AS category_slug
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        {clause}
        ORDER BY p.updated_at DESC, p.id DESC
        """
    ).fetchall()
    result = []
    for row in rows:
        item = row_dict(row)
        item["file_url"] = public_path(item.pop("file_path"))
        item["thumbnail_url"] = public_path(item.pop("thumbnail_path"))
        item["metadata"] = json.loads(item.pop("metadata_json") or "{}")
        result.append(item)
    return result


def tumbler_payload(conn, include_inactive=False):
    clause = "" if include_inactive else "WHERE active=1"
    rows = conn.execute(f"SELECT * FROM tumblers {clause} ORDER BY ounces, has_handle, id").fetchall()
    result = []
    for row in rows:
        item = row_dict(row)
        item["model_url"] = public_path(item.pop("model_path"))
        item["metadata"] = json.loads(item.pop("metadata_json") or "{}")
        result.append(item)
    return result


def safe_filename(filename):
    base = Path(filename or "upload.bin").name
    stem = "".join(ch for ch in Path(base).stem if ch.isalnum() or ch in ("-", "_")).strip() or "file"
    suffix = Path(base).suffix.lower()
    return f"{stem}-{secrets.token_hex(6)}{suffix}"


def save_upload(field, folder, allowed):
    if field is None or not getattr(field, "filename", None):
        return None
    suffix = Path(field.filename).suffix.lower().lstrip(".")
    if suffix not in allowed:
        raise ValueError(f"Tipo de archivo no permitido: .{suffix}")
    folder_path = UPLOAD_DIR / folder
    folder_path.mkdir(parents=True, exist_ok=True)
    name = safe_filename(field.filename)
    target = folder_path / name
    with target.open("wb") as out:
        shutil.copyfileobj(field.file, out)
    return f"uploads/{folder}/{name}"


class AppHandler(BaseHTTPRequestHandler):
    server_version = "CustomForgeHTTP/1.0"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def parse_multipart(self):
        env = {
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": self.headers.get("Content-Type"),
            "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
        }
        return cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ=env)

    def current_admin(self):
        jar = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        morsel = jar.get(ADMIN_COOKIE)
        if not morsel:
            return False
        token = morsel.value
        expiry = SESSIONS.get(token)
        if not expiry or expiry < now():
            SESSIONS.pop(token, None)
            return False
        return True

    def require_admin(self):
        if not self.current_admin():
            self.send_json({"error": "No autorizado"}, 401)
            return False
        return True

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/catalog":
            with db() as conn:
                self.send_json({
                    "categories": category_payload(conn),
                    "products": product_payload(conn),
                    "tumblers": tumbler_payload(conn),
                })
            return
        if path == "/api/admin/data":
            if not self.require_admin():
                return
            with db() as conn:
                self.send_json({
                    "categories": category_payload(conn),
                    "products": product_payload(conn, include_inactive=True),
                    "tumblers": tumbler_payload(conn, include_inactive=True),
                })
            return
        if path == "/api/admin/session":
            self.send_json({"authenticated": self.current_admin()})
            return
        self.serve_file(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/admin/login":
            data = self.read_json()
            password = data.get("password", "")
            with db() as conn:
                stored = conn.execute("SELECT value FROM settings WHERE key='admin_password_hash'").fetchone()["value"]
            if not verify_password(password, stored):
                self.send_json({"error": "Contraseña incorrecta"}, 403)
                return
            token = secrets.token_urlsafe(32)
            SESSIONS[token] = now() + 60 * 60 * 12
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Set-Cookie", f"{ADMIN_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200")
            body = b'{"ok": true}'
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/admin/logout":
            jar = cookies.SimpleCookie(self.headers.get("Cookie", ""))
            token = jar.get(ADMIN_COOKIE).value if jar.get(ADMIN_COOKIE) else ""
            SESSIONS.pop(token, None)
            self.send_response(200)
            self.send_header("Set-Cookie", f"{ADMIN_COOKIE}=; Path=/; Max-Age=0")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok": true}')
            return
        if path == "/api/admin/category":
            if not self.require_admin():
                return
            self.save_category()
            return
        if path == "/api/admin/product":
            if not self.require_admin():
                return
            self.save_product()
            return
        if path == "/api/admin/tumbler":
            if not self.require_admin():
                return
            self.save_tumbler()
            return
        if path == "/api/admin/change-password":
            if not self.require_admin():
                return
            data = self.read_json()
            password = data.get("password", "")
            if len(password) < 6:
                self.send_json({"error": "Usa al menos 6 caracteres"}, 400)
                return
            with db() as conn:
                conn.execute("UPDATE settings SET value=? WHERE key='admin_password_hash'", (password_hash(password),))
            self.send_json({"ok": True})
            return
        self.send_json({"error": "Ruta no encontrada"}, 404)

    def do_DELETE(self):
        if not self.require_admin():
            return
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        item_id = int(qs.get("id", ["0"])[0] or 0)
        table = {
            "/api/admin/category": "categories",
            "/api/admin/product": "products",
            "/api/admin/tumbler": "tumblers",
        }.get(parsed.path)
        if not table or not item_id:
            self.send_json({"error": "Solicitud inválida"}, 400)
            return
        with db() as conn:
            conn.execute(f"DELETE FROM {table} WHERE id=?", (item_id,))
        self.send_json({"ok": True})

    def save_category(self):
        data = self.read_json()
        name = (data.get("name") or "").strip()
        slug = (data.get("slug") or name.lower().replace(" ", "-")).strip()
        item_id = int(data.get("id") or 0)
        active = 1 if data.get("active", True) else 0
        sort_order = int(data.get("sort_order") or 0)
        if not name:
            self.send_json({"error": "Nombre requerido"}, 400)
            return
        with db() as conn:
            if item_id:
                conn.execute(
                    "UPDATE categories SET name=?, slug=?, sort_order=?, active=? WHERE id=?",
                    (name, slug, sort_order, active, item_id),
                )
            else:
                conn.execute(
                    "INSERT INTO categories(name, slug, sort_order, active) VALUES(?, ?, ?, ?)",
                    (name, slug, sort_order, active),
                )
        self.send_json({"ok": True})

    def save_product(self):
        form = self.parse_multipart()
        item_id = int(form.getfirst("id") or 0)
        t = now()
        file_path = save_upload(form["model_file"], "products", {"stl", "glb"}) if "model_file" in form else None
        thumb_path = save_upload(form["thumbnail_file"], "thumbs", {"png", "jpg", "jpeg", "webp", "svg"}) if "thumbnail_file" in form else None
        name = form.getfirst("name", "").strip()
        if not name:
            self.send_json({"error": "Nombre requerido"}, 400)
            return
        with db() as conn:
            if item_id:
                current = conn.execute("SELECT file_path, thumbnail_path FROM products WHERE id=?", (item_id,)).fetchone()
                conn.execute(
                    """
                    UPDATE products SET category_id=?, name=?, description=?, base_price_mxn=?,
                    file_path=?, file_type=?, thumbnail_path=?, active=?, metadata_json=?, updated_at=?
                    WHERE id=?
                    """,
                    (
                        int(form.getfirst("category_id") or 0) or None,
                        name,
                        form.getfirst("description", ""),
                        float(form.getfirst("base_price_mxn") or 0),
                        file_path or current["file_path"],
                        (Path(file_path or current["file_path"] or "model.stl").suffix.lower().lstrip(".") or "stl"),
                        thumb_path or current["thumbnail_path"],
                        1 if form.getfirst("active", "1") == "1" else 0,
                        form.getfirst("metadata_json", "{}") or "{}",
                        t,
                        item_id,
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO products(category_id, name, description, base_price_mxn, file_path, file_type,
                    thumbnail_path, active, metadata_json, created_at, updated_at)
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        int(form.getfirst("category_id") or 0) or None,
                        name,
                        form.getfirst("description", ""),
                        float(form.getfirst("base_price_mxn") or 0),
                        file_path,
                        (Path(file_path or "model.stl").suffix.lower().lstrip(".") or "stl"),
                        thumb_path,
                        1 if form.getfirst("active", "1") == "1" else 0,
                        form.getfirst("metadata_json", "{}") or "{}",
                        t,
                        t,
                    ),
                )
        self.send_json({"ok": True})

    def save_tumbler(self):
        form = self.parse_multipart()
        item_id = int(form.getfirst("id") or 0)
        t = now()
        model_path = save_upload(form["model_file"], "tumblers", {"glb"}) if "model_file" in form else None
        name = form.getfirst("name", "").strip()
        if not name:
            self.send_json({"error": "Nombre requerido"}, 400)
            return
        with db() as conn:
            if item_id:
                current = conn.execute("SELECT model_path FROM tumblers WHERE id=?", (item_id,)).fetchone()
                conn.execute(
                    """
                    UPDATE tumblers SET name=?, ounces=?, has_handle=?, base_price_mxn=?,
                    engraving_price_mxn=?, model_path=?, active=?, metadata_json=?, updated_at=?
                    WHERE id=?
                    """,
                    (
                        name,
                        int(form.getfirst("ounces") or 30),
                        1 if form.getfirst("has_handle", "0") == "1" else 0,
                        float(form.getfirst("base_price_mxn") or 0),
                        float(form.getfirst("engraving_price_mxn") or 0),
                        model_path or current["model_path"],
                        1 if form.getfirst("active", "1") == "1" else 0,
                        form.getfirst("metadata_json", "{}") or "{}",
                        t,
                        item_id,
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO tumblers(name, ounces, has_handle, base_price_mxn, engraving_price_mxn,
                    model_path, active, metadata_json, created_at, updated_at)
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        name,
                        int(form.getfirst("ounces") or 30),
                        1 if form.getfirst("has_handle", "0") == "1" else 0,
                        float(form.getfirst("base_price_mxn") or 0),
                        float(form.getfirst("engraving_price_mxn") or 0),
                        model_path,
                        1 if form.getfirst("active", "1") == "1" else 0,
                        form.getfirst("metadata_json", "{}") or "{}",
                        t,
                        t,
                    ),
                )
        self.send_json({"ok": True})

    def serve_file(self, request_path):
        if request_path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if request_path in ("/", ""):
            target = PUBLIC_DIR / "index.html"
        elif request_path == "/admin":
            target = PUBLIC_DIR / "admin.html"
        else:
            relative = request_path.lstrip("/")
            if relative.startswith("uploads/"):
                target = UPLOAD_DIR / relative.removeprefix("uploads/")
            else:
                target = PUBLIC_DIR / relative
        try:
            target = target.resolve()
            allowed_roots = [PUBLIC_DIR.resolve(), UPLOAD_DIR.resolve()]
            if not any(str(target).startswith(str(root)) for root in allowed_roots):
                raise FileNotFoundError
            if not target.is_file():
                raise FileNotFoundError
            content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_text("No encontrado", 404)


if __name__ == "__main__":
    init_db()
    print(f"CustomForge backend listo en http://{HOST}:{PORT}")
    print(f"Admin: http://{HOST}:{PORT}/admin  | contraseña inicial: {DEFAULT_ADMIN_PASSWORD}")
    ThreadingHTTPServer((HOST, PORT), AppHandler).serve_forever()

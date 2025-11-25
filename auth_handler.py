# auth_handler.py
import hashlib
import hmac
import os
from functools import wraps
from flask import session, request, redirect, url_for, jsonify

# =================================================================
# === HESLÁ (interní používatelia)
# =================================================================

def generate_password_hash(password: str):
    """
    Vytvorí salt + hash (PBKDF2-HMAC-SHA256, 250k iterácií) a vracia ich v HEX.
    """
    salt = os.urandom(32)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 250000)
    return salt.hex(), key.hex()

def _to_bytes_hex_or_raw(value) -> bytes:
    """
    Prijme hex-string / ascii-bytes-of-hex / raw-bytes a vráti raw bytes.
    """
    if isinstance(value, (bytes, bytearray)):
        try:
            return bytes.fromhex(value.decode('ascii'))
        except Exception:
            return bytes(value)
    return bytes.fromhex(str(value))

def verify_password(password: str, salt_in, hash_in) -> bool:
    """
    Overí heslo. Funguje pre HEX aj RAW hodnoty v DB.
    """
    try:
        salt = _to_bytes_hex_or_raw(salt_in)
        stored_key = _to_bytes_hex_or_raw(hash_in)
        new_key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 250000)
        return hmac.compare_digest(new_key, stored_key)
    except Exception:
        return False

# =================================================================
# === RBAC (modulové a roly)
# =================================================================

def canonicalize_role(role_raw: str) -> str:
    """
    Normalizuje rolu: strip + lower a aliasy -> 'veduci'.
    """
    r = str(role_raw or '').strip().lower()
    if r in ('veduca', 'leader', 'veduca_expedicie', 'expedicia_leader'):
        return 'veduci'
    return r

# Kto smie do ktorého modulu
MODULE_ROLE_MATRIX = {
    'expedicia': {'veduci', 'expedicia', 'admin'},  # veduci má prístup do expedície
    'kancelaria': {'kancelaria', 'admin'},
    'vyroba': {'vyroba', 'admin'},
}

def module_required(module_slug: str):
    """
    Dekorátor: vyžaduje prihlásenie a prístup k danému modulu podľa MODULE_ROLE_MATRIX.
    - API cesty (/api/...) vracajú JSON 401/403
    - HTML cesty presmerujú na 'login' (uprav názov view, ak ho máš iný)
    """
    def _decorator(fn):
        @wraps(fn)
        def _wrapped(*args, **kwargs):
            user = session.get('user')
            if not user:
                if request.path.startswith('/api/'):
                    return jsonify({'error': 'Unauthorized'}), 401
                return redirect(url_for('login'))

            role = canonicalize_role(user.get('role'))
            allowed = MODULE_ROLE_MATRIX.get(module_slug, set())

            # admin má fallback prístup
            if role not in allowed and role != 'admin':
                msg = f"Nemáte oprávnenie pre modul '{module_slug}'. Váš účet má rolu '{role}'."
                if request.path.startswith('/api/'):
                    return jsonify({'error': msg}), 403
                return msg

            return fn(*args, **kwargs)
        return _wrapped
    return _decorator

def login_required(role=None):
    """
    Vyžaduje prihlásenie; voliteľne kontroluje rolu (string alebo kolekcia).
    - API cesty (/api/...) vracajú JSON 401/403
    - HTML cesty presmerujú na 'login'
    """
    def _decorator(fn):
        @wraps(fn)
        def _wrapped(*args, **kwargs):
            user = session.get('user')
            if not user:
                if request.path.startswith('/api/'):
                    return jsonify({'error': 'Unauthorized'}), 401
                return redirect(url_for('login'))

            if role:
                allowed = {canonicalize_role(r) for r in (role if isinstance(role, (list, tuple, set)) else [role])}
                current = canonicalize_role(user.get('role'))
                if current not in allowed and current != 'admin':
                    if request.path.startswith('/api/'):
                        return jsonify({'error': 'Forbidden'}), 403
                    return redirect(url_for('login'))

            return fn(*args, **kwargs)
        return _wrapped
    return _decorator

__all__ = [
    'generate_password_hash',
    'verify_password',
    'login_required',
    'module_required',
    'MODULE_ROLE_MATRIX',
    'canonicalize_role',
]

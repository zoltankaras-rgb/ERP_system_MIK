import getpass
import sys
import os
import traceback

# --- Začiatok Opravy cesty ---
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
# --- Koniec Opravy ---

try:
    import db_connector
except Exception as e:
    print("[ERROR] Nepodarilo sa importovať db_connector:", e)
    sys.exit(1)

try:
    import auth_handler  # musí mať generate_password_hash
except Exception as e:
    print("[ERROR] Nepodarilo sa importovať auth_handler:", e)
    sys.exit(1)

# ====== KONFIGURÁCIA ======
TABLE_NAME = "internal_users"
VALID_ROLES = {
    "vyroba", "expedicia", "kancelaria", "admin", "veduci", "margit",
    # aliasy pre vedúcu expedície:
    "expedicia_leader", "veduca", "leader", "veduca_expedicie",
    # aliasy pre Peťa:
    "teta_margit", "obchodak"
}

DDL_HINT = f"""
-- Vzor tabuľky, ak ešte nemáš internal_users:
CREATE TABLE `{TABLE_NAME}` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARBINARY(255) NOT NULL,
  password_salt VARBINARY(255) NOT NULL,
  role          VARCHAR(64) NOT NULL,
  full_name     VARCHAR(190) NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
""".strip()


def table_exists():
    try:
        rows = db_connector.execute_query("SHOW TABLES LIKE %s", (TABLE_NAME,))
        return bool(rows)
    except Exception:
        # Ak SHOW TABLES neprejde (iné DB), skús jednoduchý select:
        try:
            db_connector.execute_query(f"SELECT 1 FROM {TABLE_NAME} LIMIT 1")
            return True
        except Exception:
            return False


def col_exists(col):
    try:
        rows = db_connector.execute_query(
            f"SHOW COLUMNS FROM `{TABLE_NAME}` LIKE %s", (col,)
        )
        return bool(rows)
    except Exception:
        # fallback (ak SHOW COLUMNS nefunguje), necháme prejsť
        return True


def ensure_schema_minimum():
    if not table_exists():
        print(f"[ERROR] Tabuľka `{TABLE_NAME}` neexistuje.")
        print(DDL_HINT)
        sys.exit(1)
    # Minimálne požadované stĺpce
    required = ["username", "password_hash", "password_salt", "role", "full_name"]
    missing = [c for c in required if not col_exists(c)]
    if missing:
        print(f"[ERROR] V tabuľke `{TABLE_NAME}` chýbajú stĺpce: {', '.join(missing)}")
        print(DDL_HINT)
        sys.exit(1)


def get_user(username):
    return db_connector.execute_query(
        f"SELECT id, username, role, full_name, is_active FROM {TABLE_NAME} WHERE username=%s",
        (username,), fetch='one'
    )


def insert_user(username, password_hash, password_salt, role, full_name):
    db_connector.execute_query(
        f"INSERT INTO {TABLE_NAME} (username, password_hash, password_salt, role, full_name) "
        f"VALUES (%s,%s,%s,%s,%s)",
        (username, password_hash, password_salt, role, full_name),
        fetch='none'
    )


def update_user(user_id, password_hash, password_salt, role, full_name):
    db_connector.execute_query(
        f"UPDATE {TABLE_NAME} SET password_hash=%s, password_salt=%s, role=%s, full_name=%s, updated_at=NOW() "
        f"WHERE id=%s",
        (password_hash, password_salt, role, full_name, user_id),
        fetch='none'
    )


def normalize_role(role_raw: str) -> str:
    r = (role_raw or "").strip().lower()
    if r in {"veduca", "leader", "veduca_expedicie", "expedicia_leader", "expedicia"}:
        return "veduci"
    if r in {"teta_margit", "obchodak"}:
        return "margit"
    return r


def create_user():
    """
    Interaktívny skript na vytvorenie alebo úpravu interného používateľa.
    """
    print("--- Vytvorenie/úprava interného používateľa ---")

    try:
        ensure_schema_minimum()

        username = input("Zadajte používateľské meno (login/e-mail): ").strip()
        password = getpass.getpass("Zadajte heslo (nebude viditeľné): ").strip()
        password_confirm = getpass.getpass("Zopakujte heslo: ").strip()

        if not username:
            print("\nCHYBA: Používateľské meno nesmie byť prázdne.")
            return
        if not password:
            print("\nCHYBA: Heslo nesmie byť prázdne.")
            return
        if password != password_confirm:
            print("\nCHYBA: Heslá sa nezhodujú.")
            return

        print("Dostupné roly:", ", ".join(sorted(VALID_ROLES)))
        role_in = input("Zadajte rolu používateľa: ").strip().lower()
        role = normalize_role(role_in)
        if role not in VALID_ROLES:
            print(f"\nCHYBA: Neplatná rola '{role_in}'. Povolené: {', '.join(sorted(VALID_ROLES))}")
            return

        full_name = input("Zadajte celé meno používateľa (voliteľné): ").strip()

        # Overenie, či používateľ existuje
        existing = get_user(username)

        # Hash + salt (použi tvoju auth_handler implementáciu)
        try:
            # Očakávame návrat (salt, hash) v bytes/str
            salt, hsh = auth_handler.generate_password_hash(password)
        except TypeError:
            # Robustný fallback pre iné tvary návratovej hodnoty
            out = auth_handler.generate_password_hash(password)
            if isinstance(out, (tuple, list)) and len(out) == 2:
                salt, hsh = out
            elif isinstance(out, dict) and "salt" in out and "hash" in out:
                salt, hsh = out["salt"], out["hash"]
            else:
                print("\nCHYBA: auth_handler.generate_password_hash() nevrátil (salt, hash). Upraviť skript podľa tvojej implementácie.")
                return

        if existing:
            print(f"\nINFO: Používateľ '{username}' už existuje (id={existing['id']}).")
            do_update = input("Chcete aktualizovať heslo/rolu/meno? (y/N): ").strip().lower() == 'y'
            if not do_update:
                print("Zrušené. Nič som neupravil.")
                return
            update_user(existing['id'], hsh, salt, role, full_name or existing.get('full_name'))
            print(f"\nOK: Používateľ '{username}' bol aktualizovaný. Rola={role}")
        else:
            insert_user(username, hsh, salt, role, full_name or None)
            print(f"\nOK: Používateľ '{username}' bol vytvorený. Rola={role}")

        print("\nTIP: Pre vedúceho expedície použi rolu 'veduci'. Pre Peťa použi 'margit'.")

    except Exception:
        print("\n!!! NEOČAKÁVANÁ CHYBA PRI VYTVÁRANÍ/UPRAVE POUŽÍVATEĽA !!!")
        print(traceback.format_exc())


if __name__ == '__main__':
    create_user()
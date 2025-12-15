import integration_handler
from datetime import datetime
import traceback

# =================================================================
# === MODUL PRE AUTOMATICKÉ SPÚŠŤANIE PLÁNOVANÝCH ÚLOH ===
# =================================================================

def run_daily_tasks():
    """
    Spustí všetky denné naplánované úlohy.
    Tento skript je navrhnutý tak, aby ho bolo možné volať
    z externého nástroja, ako je Plánovač úloh vo Windows alebo cron v Linuxe.
    """
    print("="*50)
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Spúšťam denné naplánované úlohy...")
    print("="*50)

    try:
        # 1. Automatický export denného príjmu
        print("\n[INFO] Spúšťam export denného príjmu...")
        export_result = integration_handler.generate_daily_receipt_export()
        
        if "error" in export_result:
            print(f"[CHYBA] Export zlyhal: {export_result['error']}")
        else:
            print(f"[ÚSPECH] Export dokončený: {export_result['message']}")

        # 2. Automatický import stavu skladu
        print("\n[INFO] Spúšťam import stavu skladu z externého systému...")
        import_result = integration_handler.process_stock_update_import()
        
        if "error" in import_result:
            print(f"[CHYBA] Import zlyhal: {import_result['error']}")
        else:
            print(f"[ÚSPECH] Import dokončený: {import_result['message']}")
            
    except Exception as e:
        print("\n" + "!"*50)
        print(f"[KRITICKÁ CHYBA] Počas behu naplánovaných úloh nastala neočakávaná chyba:")
        print(traceback.format_exc())
        print("!"*50)
    
    finally:
        print("\n" + "="*50)
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Všetky denné úlohy boli dokončené.")
        print("="*50)

if __name__ == '__main__':
    import sys
    fn = (sys.argv[1] if len(sys.argv) > 1 else "run_daily_tasks").strip()
    if fn == "run_daily_tasks":
        run_daily_tasks()
    else:
        print(f"Neznáma úloha: {fn}")

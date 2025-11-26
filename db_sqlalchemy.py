import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# Načítanie .env (použije rovnaké heslá ako db_connector)
load_dotenv()

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_DATABASE = os.getenv("DB_DATABASE", "vyrobny_system")

# Vytvorenie URL pre SQLAlchemy
# Používame ovládač mysqlconnector, ktorý už máte nainštalovaný
DATABASE_URL = f"mysql+mysqlconnector://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_DATABASE}"

# Nastavenie engine (pripojenia)
engine = create_engine(
    DATABASE_URL,
    pool_recycle=3600,
    pool_pre_ping=True
)

# Vytvorenie SessionLocal triedy, ktorú používa calendar_api.py
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
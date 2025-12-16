from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

# Toto inicializuje databázu
db = SQLAlchemy()

# 1. Tabuľka pre Cenníky (hlavička)
class Cennik(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nazov = db.Column(db.String(100), nullable=False)  # Napr. "VIP Klient Jeseň"
    email = db.Column(db.String(120))                  # Predvolený email: klient@firma.sk
    datum_vytvorenia = db.Column(db.DateTime, default=datetime.utcnow)

    # Prepojenie na položky (aby sme vedeli, čo patrí do tohto cenníka)
    polozky = db.relationship('PolozkaCennika', backref='cennik', lazy=True, cascade="all, delete-orphan")

# 2. Tabuľka pre Položky v cenníku (riadky)
class PolozkaCennika(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    cennik_id = db.Column(db.Integer, db.ForeignKey('cennik.id'), nullable=False)
    nazov_produktu = db.Column(db.String(200), nullable=False)
    mj = db.Column(db.String(20))       # Merná jednotka (ks, kg...)
    cena = db.Column(db.Float, nullable=False)
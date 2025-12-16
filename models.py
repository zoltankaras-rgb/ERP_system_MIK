# Súbor: models.py
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Cennik(db.Model):
    __tablename__ = 'cenniky'
    id = db.Column(db.Integer, primary_key=True)
    nazov = db.Column(db.String(100), nullable=False)  # Napr. "Cenník Jeseň 2025"
    poznamka = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.now)
    
    # Vzťah 1:N (Jeden cenník má veľa položiek)
    polozky = db.relationship('PolozkaCennika', backref='cennik', lazy=True, cascade="all, delete-orphan")

class PolozkaCennika(db.Model):
    __tablename__ = 'polozky_cennika'
    id = db.Column(db.Integer, primary_key=True)
    cennik_id = db.Column(db.Integer, db.ForeignKey('cenniky.id'), nullable=False)
    nazov_produktu = db.Column(db.String(200), nullable=False)
    cena = db.Column(db.Float, nullable=False)
    povodna_cena = db.Column(db.Float, nullable=True) # Pre výpočet zľavy
    mj = db.Column(db.String(20), default="ks")
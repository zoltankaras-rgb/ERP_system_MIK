# models.py
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Cennik(db.Model):
    __tablename__ = 'cenniky'
    id = db.Column(db.Integer, primary_key=True)
    nazov = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120))
    created_at = db.Column(db.DateTime, default=datetime.now)
    polozky = db.relationship('PolozkaCennika', backref='cennik', lazy=True, cascade="all, delete-orphan")

class PolozkaCennika(db.Model):
    __tablename__ = 'polozky_cennika'
    id = db.Column(db.Integer, primary_key=True)
    cennik_id = db.Column(db.Integer, db.ForeignKey('cenniky.id'), nullable=False)
    nazov_produktu = db.Column(db.String(200), nullable=False)
    
    # ZMENA: Predvolené je 'kg'
    mj = db.Column(db.String(20), default="kg") 
    
    cena = db.Column(db.Float, nullable=False)         # Cena bez DPH
    povodna_cena = db.Column(db.Float, default=0.0)
    
    # NOVÉ: Ukladáme aj DPH
    dph = db.Column(db.Float, default=20.0)            
    
    is_action = db.Column(db.Boolean, default=False)
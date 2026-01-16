# models.py
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Cennik(db.Model):
    # POZOR: Ak sa tabuľka v DB volá 'b2b_cenniky', prepíš to tu na 'b2b_cenniky'
    __tablename__ = 'cenniky' 
    
    id = db.Column(db.Integer, primary_key=True)
    nazov = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120))
    created_at = db.Column(db.DateTime, default=datetime.now)
    
    # TOTO TU CHÝBALO - Pridaj tento riadok:
    platnost_od = db.Column(db.Date, nullable=True)

    polozky = db.relationship('PolozkaCennika', backref='cennik', lazy=True, cascade="all, delete-orphan")

class PolozkaCennika(db.Model):
    __tablename__ = 'polozky_cennika'
    id = db.Column(db.Integer, primary_key=True)
    cennik_id = db.Column(db.Integer, db.ForeignKey('cenniky.id'), nullable=False) # Ak zmeníš tablename vyššie, zmeň aj tu na 'b2b_cenniky.id'
    nazov_produktu = db.Column(db.String(200), nullable=False)
    
    mj = db.Column(db.String(20), default="kg") 
    
    cena = db.Column(db.Float, nullable=False)         # Cena bez DPH
    povodna_cena = db.Column(db.Float, default=0.0)
    
    dph = db.Column(db.Float, default=20.0)            
    
    is_action = db.Column(db.Boolean, default=False)
from flask import Blueprint, render_template, session, redirect, url_for
from auth_handler import module_required

# Vytvoríme Blueprint s názvom 'margit'
margit_bp = Blueprint('margit', __name__)

# Cesta pre Peťovu hlavnú nástenku
@margit_bp.route('/margit')
@module_required('margit')  # Pustí dnu len rolu 'margit' (a 'admin')
def margit_dashboard():
    # Tu neskôr budeme ťahať dáta z tvojej databázy len pre jeho B2B objednávky
    return render_template('margit.html')
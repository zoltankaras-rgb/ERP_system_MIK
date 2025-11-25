# wsgi.py – entrypoint pre gunicorn
from app import app

# gunicorn očakáva premennú 'app'
# (žiadne if __name__ == "__main__" sem netreba)

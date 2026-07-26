"""Updated app.py with database models"""
import os
from flask import Flask
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize extensions
db = SQLAlchemy()
jwt = JWTManager()

def create_app():
    """
    Application factory function to create Flask app
    """
    app = Flask(__name__)
    
    # Configuration
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv(
        'DATABASE_URL',
        'sqlite:///horizon_inn.db'  # Default SQLite for development
    )
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
    app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'jwt-secret-key-change-in-production')
    
    # Initialize extensions with app
    db.init_app(app)
    jwt.init_app(app)
    CORS(app, resources={r"/api/*": {"origins": "*"}})
    
    # Import models
    from database import User, Room, Booking
    
    # Register blueprints
    from routes.rooms import rooms_bp
    from routes.bookings import bookings_bp
    from routes.auth import auth_bp
    
    app.register_blueprint(rooms_bp)
    app.register_blueprint(bookings_bp)
    app.register_blueprint(auth_bp)
    
    # Create database tables
    with app.app_context():
        db.create_all()
        print("✓ Database tables created successfully")
    
    # Health check endpoint
    @app.route('/api/health', methods=['GET'])
    def health():
        return {
            'status': 'ok',
            'message': 'Horizon Inn API is running',
            'database': 'connected'
        }, 200
    
    # Root endpoint
    @app.route('/', methods=['GET'])
    def index():
        return {
            'name': 'Horizon Inn API',
            'version': '1.0.0',
            'description': 'Hotel Management System API',
            'docs': '/api/docs'
        }, 200
    
    return app

if __name__ == '__main__':
    app = create_app()
    port = int(os.getenv('FLASK_RUN_PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)

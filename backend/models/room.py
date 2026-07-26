from datetime import datetime
from app import db

class Room(db.Model):
    """
    Room model for storing room information
    """
    __tablename__ = 'rooms'
    
    id = db.Column(db.Integer, primary_key=True)
    room_number = db.Column(db.String(10), unique=True, nullable=False)
    room_type = db.Column(db.String(50), nullable=False)  # Deluxe, Premium, Luxury, Family
    price_per_night = db.Column(db.Integer, nullable=False)  # In PKR
    capacity = db.Column(db.Integer, default=2)
    floor = db.Column(db.Integer, nullable=False)
    is_available = db.Column(db.Boolean, default=True)
    description = db.Column(db.Text)
    amenities = db.Column(db.String(500))  # JSON string
    image_url = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    bookings = db.relationship('Booking', backref='room', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        """
        Convert room object to dictionary
        """
        return {
            'id': self.id,
            'room_number': self.room_number,
            'room_type': self.room_type,
            'price_per_night': self.price_per_night,
            'capacity': self.capacity,
            'floor': self.floor,
            'is_available': self.is_available,
            'description': self.description,
            'amenities': self.amenities.split(',') if self.amenities else [],
            'image_url': self.image_url,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }
    
    def __repr__(self):
        return f'<Room {self.room_number}>'

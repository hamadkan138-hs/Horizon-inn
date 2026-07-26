from datetime import datetime
from app import db

class Booking(db.Model):
    """
    Booking model for room reservations
    """
    __tablename__ = 'bookings'
    
    id = db.Column(db.Integer, primary_key=True)
    booking_number = db.Column(db.String(20), unique=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    room_id = db.Column(db.Integer, db.ForeignKey('rooms.id'), nullable=False)
    guest_name = db.Column(db.String(120), nullable=False)
    guest_email = db.Column(db.String(120), nullable=False)
    guest_phone = db.Column(db.String(20), nullable=False)
    check_in = db.Column(db.DateTime, nullable=False)
    check_out = db.Column(db.DateTime, nullable=False)
    number_of_guests = db.Column(db.Integer, default=1)
    total_price = db.Column(db.Integer, nullable=False)  # In PKR
    status = db.Column(db.String(20), default='pending')  # pending, confirmed, checked_in, checked_out, cancelled
    special_requests = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        """
        Convert booking object to dictionary
        """
        return {
            'id': self.id,
            'booking_number': self.booking_number,
            'user_id': self.user_id,
            'room_id': self.room_id,
            'guest_name': self.guest_name,
            'guest_email': self.guest_email,
            'guest_phone': self.guest_phone,
            'check_in': self.check_in.isoformat(),
            'check_out': self.check_out.isoformat(),
            'number_of_guests': self.number_of_guests,
            'total_price': self.total_price,
            'status': self.status,
            'special_requests': self.special_requests,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }
    
    def __repr__(self):
        return f'<Booking {self.booking_number}>'

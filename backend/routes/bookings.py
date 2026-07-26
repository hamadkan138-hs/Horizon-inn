from flask import Blueprint, request, jsonify
from datetime import datetime
from app import db
from models.booking import Booking
from models.room import Room

bookings_bp = Blueprint('bookings', __name__, url_prefix='/api/bookings')

@bookings_bp.route('', methods=['GET'])
def get_all_bookings():
    """
    Get all bookings
    """
    try:
        bookings = Booking.query.all()
        
        return jsonify({
            'success': True,
            'count': len(bookings),
            'data': [booking.to_dict() for booking in bookings]
        }), 200
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@bookings_bp.route('/<int:booking_id>', methods=['GET'])
def get_booking(booking_id):
    """
    Get a specific booking
    """
    try:
        booking = Booking.query.get(booking_id)
        
        if not booking:
            return jsonify({
                'success': False,
                'error': 'Booking not found'
            }), 404
        
        return jsonify({
            'success': True,
            'data': booking.to_dict()
        }), 200
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@bookings_bp.route('', methods=['POST'])
def create_booking():
    """
    Create a new booking
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['room_id', 'guest_name', 'guest_email', 'guest_phone', 'check_in', 'check_out']
        if not all(field in data for field in required_fields):
            return jsonify({
                'success': False,
                'error': 'Missing required fields'
            }), 400
        
        # Check if room exists
        room = Room.query.get(data['room_id'])
        if not room:
            return jsonify({
                'success': False,
                'error': 'Room not found'
            }), 404
        
        # Parse dates
        check_in = datetime.fromisoformat(data['check_in'].replace('Z', '+00:00'))
        check_out = datetime.fromisoformat(data['check_out'].replace('Z', '+00:00'))
        
        # Calculate total price
        nights = (check_out - check_in).days
        total_price = nights * room.price_per_night
        
        # Generate booking number
        booking_number = f"BK{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        # Create booking
        new_booking = Booking(
            booking_number=booking_number,
            user_id=data.get('user_id', 1),  # Default to 1 for demo
            room_id=data['room_id'],
            guest_name=data['guest_name'],
            guest_email=data['guest_email'],
            guest_phone=data['guest_phone'],
            check_in=check_in,
            check_out=check_out,
            number_of_guests=data.get('number_of_guests', 1),
            total_price=total_price,
            special_requests=data.get('special_requests', '')
        )
        
        db.session.add(new_booking)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Booking created successfully',
            'data': new_booking.to_dict()
        }), 201
    
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

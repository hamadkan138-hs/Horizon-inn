"""Updated routes/rooms.py with database integration"""
from flask import Blueprint, request, jsonify
from app import db
from database import Room

rooms_bp = Blueprint('rooms', __name__, url_prefix='/api/rooms')

@rooms_bp.route('', methods=['GET'])
def get_all_rooms():
    """
    Get all rooms with optional filters
    Query params: available (true/false), room_type (string)
    """
    try:
        # Get query parameters
        available = request.args.get('available', type=lambda x: x.lower() == 'true')
        room_type = request.args.get('room_type', type=str)
        
        # Build query
        query = Room.query
        
        if available is not None:
            query = query.filter_by(is_available=available)
        
        if room_type:
            query = query.filter_by(room_type=room_type)
        
        rooms = query.all()
        
        return jsonify({
            'success': True,
            'count': len(rooms),
            'data': [room.to_dict() for room in rooms]
        }), 200
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@rooms_bp.route('/<int:room_id>', methods=['GET'])
def get_room(room_id):
    """
    Get a specific room by ID
    """
    try:
        room = Room.query.get(room_id)
        
        if not room:
            return jsonify({
                'success': False,
                'error': 'Room not found'
            }), 404
        
        return jsonify({
            'success': True,
            'data': room.to_dict()
        }), 200
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@rooms_bp.route('', methods=['POST'])
def create_room():
    """
    Create a new room (Admin only)
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['room_number', 'room_type', 'price_per_night', 'floor']
        if not all(field in data for field in required_fields):
            return jsonify({
                'success': False,
                'error': 'Missing required fields: ' + ', '.join(required_fields)
            }), 400
        
        # Check if room already exists
        existing_room = Room.query.filter_by(room_number=data['room_number']).first()
        if existing_room:
            return jsonify({
                'success': False,
                'error': 'Room with this number already exists'
            }), 409
        
        # Create new room
        new_room = Room(
            room_number=data['room_number'],
            room_type=data['room_type'],
            price_per_night=int(data['price_per_night']),
            capacity=data.get('capacity', 2),
            floor=int(data['floor']),
            description=data.get('description', ''),
            amenities=','.join(data.get('amenities', [])) if isinstance(data.get('amenities'), list) else data.get('amenities', ''),
            image_url=data.get('image_url', ''),
            is_available=data.get('is_available', True)
        )
        
        db.session.add(new_room)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Room created successfully',
            'data': new_room.to_dict()
        }), 201
    
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@rooms_bp.route('/<int:room_id>', methods=['PUT'])
def update_room(room_id):
    """
    Update a room (Admin only)
    """
    try:
        room = Room.query.get(room_id)
        
        if not room:
            return jsonify({
                'success': False,
                'error': 'Room not found'
            }), 404
        
        data = request.get_json()
        
        # Update fields
        if 'room_type' in data:
            room.room_type = data['room_type']
        if 'price_per_night' in data:
            room.price_per_night = int(data['price_per_night'])
        if 'capacity' in data:
            room.capacity = data['capacity']
        if 'is_available' in data:
            room.is_available = data['is_available']
        if 'description' in data:
            room.description = data['description']
        if 'amenities' in data:
            if isinstance(data['amenities'], list):
                room.amenities = ','.join(data['amenities'])
            else:
                room.amenities = data['amenities']
        if 'image_url' in data:
            room.image_url = data['image_url']
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Room updated successfully',
            'data': room.to_dict()
        }), 200
    
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@rooms_bp.route('/<int:room_id>', methods=['DELETE'])
def delete_room(room_id):
    """
    Delete a room (Admin only)
    """
    try:
        room = Room.query.get(room_id)
        
        if not room:
            return jsonify({
                'success': False,
                'error': 'Room not found'
            }), 404
        
        db.session.delete(room)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Room deleted successfully'
        }), 200
    
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

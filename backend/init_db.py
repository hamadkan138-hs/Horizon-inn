"""Database initialization script"""
import os
from app import create_app, db
from database import User, Room, Booking
from datetime import datetime, timedelta

def init_db():
    """
    Initialize database with sample data
    """
    app = create_app()
    
    with app.app_context():
        # Clear existing data
        print("Clearing existing data...")
        db.drop_all()
        
        # Create all tables
        print("Creating tables...")
        db.create_all()
        
        # Create admin user
        print("Creating admin user...")
        admin = User(
            email='admin@horizoninn.click',
            first_name='Admin',
            last_name='User',
            phone='+92-91-5201234',
            is_admin=True,
            is_active=True
        )
        admin.set_password('admin123')
        db.session.add(admin)
        
        # Create sample customer
        print("Creating sample customer...")
        customer = User(
            email='customer@example.com',
            first_name='John',
            last_name='Doe',
            phone='+92-300-1234567',
            is_admin=False,
            is_active=True
        )
        customer.set_password('customer123')
        db.session.add(customer)
        
        db.session.commit()
        print("✓ Users created")
        
        # Create rooms
        print("Creating rooms...")
        rooms_data = [
            {
                'room_number': '101',
                'room_type': 'Deluxe',
                'price_per_night': 5000,
                'capacity': 2,
                'floor': 1,
                'description': 'Comfortable room with modern amenities',
                'amenities': 'WiFi,TV,AC,Hot Water,Mini Bar',
                'is_available': True
            },
            {
                'room_number': '102',
                'room_type': 'Deluxe',
                'price_per_night': 5000,
                'capacity': 2,
                'floor': 1,
                'description': 'Comfortable room with modern amenities',
                'amenities': 'WiFi,TV,AC,Hot Water,Mini Bar',
                'is_available': True
            },
            {
                'room_number': '201',
                'room_type': 'Premium',
                'price_per_night': 7000,
                'capacity': 3,
                'floor': 2,
                'description': 'Spacious suite with luxury furnishings',
                'amenities': 'WiFi,Smart TV,AC,Hot Water,Mini Bar,Living Area',
                'is_available': True
            },
            {
                'room_number': '202',
                'room_type': 'Premium',
                'price_per_night': 7000,
                'capacity': 3,
                'floor': 2,
                'description': 'Spacious suite with luxury furnishings',
                'amenities': 'WiFi,Smart TV,AC,Hot Water,Mini Bar,Living Area',
                'is_available': True
            },
            {
                'room_number': '301',
                'room_type': 'Luxury',
                'price_per_night': 9000,
                'capacity': 4,
                'floor': 3,
                'description': 'Premium suite with all amenities and Jacuzzi',
                'amenities': 'WiFi,Smart TV,AC,Hot Water,Mini Bar,Jacuzzi,Living Area',
                'is_available': True
            },
            {
                'room_number': '302',
                'room_type': 'Luxury',
                'price_per_night': 9000,
                'capacity': 4,
                'floor': 3,
                'description': 'Premium suite with all amenities and Jacuzzi',
                'amenities': 'WiFi,Smart TV,AC,Hot Water,Mini Bar,Jacuzzi,Living Area',
                'is_available': False
            },
        ]
        
        for room_data in rooms_data:
            room = Room(**room_data)
            db.session.add(room)
        
        db.session.commit()
        print("✓ Rooms created")
        
        # Create sample bookings
        print("Creating sample bookings...")
        check_in = datetime.now() + timedelta(days=1)
        check_out = check_in + timedelta(days=3)
        
        booking = Booking(
            booking_number=f"BK{datetime.now().strftime('%Y%m%d%H%M%S')}",
            user_id=customer.id,
            room_id=1,
            guest_name='John Doe',
            guest_email='john@example.com',
            guest_phone='+92-300-1234567',
            check_in=check_in,
            check_out=check_out,
            number_of_guests=2,
            total_price=15000,  # 3 nights * 5000
            status='pending',
            special_requests='Early check-in if possible'
        )
        db.session.add(booking)
        db.session.commit()
        print("✓ Bookings created")
        
        print("\n✅ Database initialized successfully!")
        print(f"\n📊 Database Statistics:")
        print(f"   - Users: {User.query.count()}")
        print(f"   - Rooms: {Room.query.count()}")
        print(f"   - Bookings: {Booking.query.count()}")
        print(f"\n🔐 Admin Credentials:")
        print(f"   Email: admin@horizoninn.click")
        print(f"   Password: admin123")

if __name__ == '__main__':
    init_db()

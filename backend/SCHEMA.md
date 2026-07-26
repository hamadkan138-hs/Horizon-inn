"""SQL Schema documentation"""

"""
Database Schema for Horizon Inn

Tables:
1. users - Store user/admin information
2. rooms - Store room details and availability
3. bookings - Store booking information

Relationships:
- One User has Many Bookings
- One Room has Many Bookings
- One Booking belongs to One User
- One Booking belongs to One Room
"""

# CREATE TABLE users (
#     id INTEGER PRIMARY KEY AUTO_INCREMENT,
#     email VARCHAR(120) UNIQUE NOT NULL,
#     password_hash VARCHAR(255) NOT NULL,
#     first_name VARCHAR(100) NOT NULL,
#     last_name VARCHAR(100) NOT NULL,
#     phone VARCHAR(20),
#     is_admin BOOLEAN DEFAULT FALSE,
#     is_active BOOLEAN DEFAULT TRUE,
#     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
#     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
#     INDEX(email)
# );

# CREATE TABLE rooms (
#     id INTEGER PRIMARY KEY AUTO_INCREMENT,
#     room_number VARCHAR(10) UNIQUE NOT NULL,
#     room_type VARCHAR(50) NOT NULL,
#     price_per_night INTEGER NOT NULL,
#     capacity INTEGER DEFAULT 2,
#     floor INTEGER NOT NULL,
#     is_available BOOLEAN DEFAULT TRUE,
#     description TEXT,
#     amenities VARCHAR(500),
#     image_url VARCHAR(500),
#     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
#     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
#     INDEX(room_number)
# );

# CREATE TABLE bookings (
#     id INTEGER PRIMARY KEY AUTO_INCREMENT,
#     booking_number VARCHAR(20) UNIQUE NOT NULL,
#     user_id INTEGER NOT NULL,
#     room_id INTEGER NOT NULL,
#     guest_name VARCHAR(120) NOT NULL,
#     guest_email VARCHAR(120) NOT NULL,
#     guest_phone VARCHAR(20) NOT NULL,
#     check_in DATETIME NOT NULL,
#     check_out DATETIME NOT NULL,
#     number_of_guests INTEGER DEFAULT 1,
#     total_price INTEGER NOT NULL,
#     status VARCHAR(20) DEFAULT 'pending',
#     special_requests TEXT,
#     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
#     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
#     FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
#     FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE,
#     INDEX(booking_number),
#     INDEX(user_id),
#     INDEX(room_id)
# );

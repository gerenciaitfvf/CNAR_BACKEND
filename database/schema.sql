-- =====================================================================
-- CNAR MARGARITA - PMS (Property Management System)
-- Diagrama Entidad-Relación (MER) - MySQL 8+
-- Base de datos: cnar_fvf (existe en el EC2 de produccion)
-- =====================================================================
-- ESTRUCTURA:
--   roles -> users -> bookings -> guests
--   rooms -> cleaning_records <- room_cleaning_staff -> users
-- =====================================================================

USE cnar_fvf;

-- Limpieza idempotente: dropea solo las tablas del PMS si ya existen
-- (no toca otras tablas que convivan en cnar_fvf)
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS maintenance_tickets;
DROP TABLE IF EXISTS room_cleaning_staff;
DROP TABLE IF EXISTS cleaning_records;
DROP TABLE IF EXISTS booking_guests;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS guests;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- 1) ROLES
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(60) NOT NULL UNIQUE,
  slug          VARCHAR(60) NOT NULL UNIQUE,
  description   VARCHAR(255) NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2) USERS (Personal del hotel + usuarios del sistema)
--    password_hash -> bcrypt (10+ rounds). NUNCA guardar texto plano.
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  role_id         INT NOT NULL,
  full_name       VARCHAR(120) NOT NULL,
  email           VARCHAR(120) NOT NULL UNIQUE,
  document_type   ENUM('V','E','PASSPORT') NULL,
  document_number VARCHAR(40) NULL,
  phone           VARCHAR(30) NULL,
  password_hash   VARCHAR(255) NOT NULL,  -- bcrypt $2b$10$...
  is_active       TINYINT(1) DEFAULT 1,
  staff_kind      ENUM('CLEANING','MAINTENANCE','RECEPTION','SYSTEM') NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB;

CREATE INDEX idx_users_staff_kind ON users(staff_kind);
CREATE INDEX idx_users_role      ON users(role_id);

-- ---------------------------------------------------------------------
-- 3) ROOMS (Inventario fijo del hotel)
--    status: AVAILABLE | OCCUPIED | MAINTENANCE | CLEANING
-- ---------------------------------------------------------------------
CREATE TABLE rooms (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  room_number  VARCHAR(10) NOT NULL UNIQUE,
  floor        TINYINT NOT NULL,
  room_type    ENUM('STANDARD','SUITE') NOT NULL,
  capacity     TINYINT NOT NULL DEFAULT 3,   -- 1..3 huespedes
  status       ENUM('AVAILABLE','OCCUPIED','MAINTENANCE','CLEANING') NOT NULL DEFAULT 'AVAILABLE',
  notes        VARCHAR(255) NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_floor CHECK (floor BETWEEN 1 AND 5)
) ENGINE=InnoDB;

CREATE INDEX idx_rooms_floor   ON rooms(floor);
CREATE INDEX idx_rooms_status  ON rooms(status);

-- ---------------------------------------------------------------------
-- 4) GUESTS (Huespedes - datos de identificacion)
-- ---------------------------------------------------------------------
CREATE TABLE guests (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  document_type   ENUM('PASSPORT','V','E') NOT NULL,
  document_number VARCHAR(40) NOT NULL,
  full_name       VARCHAR(150) NOT NULL,
  birth_date      DATE NULL,
  address         VARCHAR(255) NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_guest_doc UNIQUE (document_type, document_number)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5) BOOKINGS (Registro / Check-In en una habitacion)
-- ---------------------------------------------------------------------
CREATE TABLE bookings (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  room_id      INT NOT NULL,
  check_in_at  DATETIME NOT NULL,
  check_out_at DATETIME NULL,
  status       ENUM('OPEN','CLOSED','CANCELLED') NOT NULL DEFAULT 'OPEN',
  notes        VARCHAR(255) NULL,
  created_by   INT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bookings_room    FOREIGN KEY (room_id)    REFERENCES rooms(id),
  CONSTRAINT fk_bookings_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE INDEX idx_bookings_room   ON bookings(room_id);
CREATE INDEX idx_bookings_status ON bookings(status);

-- ---------------------------------------------------------------------
-- 6) BOOKING_GUESTS (N:M booking <-> guests)
-- ---------------------------------------------------------------------
CREATE TABLE booking_guests (
  booking_id  INT NOT NULL,
  guest_id    INT NOT NULL,
  is_lead     TINYINT(1) DEFAULT 0,
  PRIMARY KEY (booking_id, guest_id),
  CONSTRAINT fk_bg_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_bg_guest   FOREIGN KEY (guest_id)   REFERENCES guests(id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7) CLEANING_RECORDS (Cabecera del aseo de una habitacion)
--    Una limpieza la pueden realizar UNA o VARIAS camareras a la vez.
-- ---------------------------------------------------------------------
CREATE TABLE cleaning_records (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  room_id     INT NOT NULL,
  cleaned_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes       VARCHAR(255) NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cleaning_room FOREIGN KEY (room_id) REFERENCES rooms(id)
) ENGINE=InnoDB;

CREATE INDEX idx_cleaning_room    ON cleaning_records(room_id);
CREATE INDEX idx_cleaning_cleaned ON cleaning_records(cleaned_at);

-- ---------------------------------------------------------------------
-- 8) ROOM_CLEANING_STAFF  *** TABLA INTERMEDIA (N:M) ***
--    Conecta cleaning_records con users (camareras).
--    Permite 1..N camareras por aseo simultaneamente.
-- ---------------------------------------------------------------------
CREATE TABLE room_cleaning_staff (
  cleaning_id  INT NOT NULL,
  user_id      INT NOT NULL,
  PRIMARY KEY (cleaning_id, user_id),
  CONSTRAINT fk_rcs_cleaning FOREIGN KEY (cleaning_id) REFERENCES cleaning_records(id) ON DELETE CASCADE,
  CONSTRAINT fk_rcs_user     FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

CREATE INDEX idx_rcs_user ON room_cleaning_staff(user_id);

-- ---------------------------------------------------------------------
-- 9) MAINTENANCE_TICKETS
-- ---------------------------------------------------------------------
CREATE TABLE maintenance_tickets (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  room_id      INT NOT NULL,
  opened_by    INT NOT NULL,
  assigned_to  INT NULL,
  title        VARCHAR(150) NOT NULL,
  description  TEXT NULL,
  priority     ENUM('LOW','MEDIUM','HIGH') DEFAULT 'MEDIUM',
  status       ENUM('OPEN','IN_PROGRESS','RESOLVED','CLOSED') DEFAULT 'OPEN',
  opened_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at  DATETIME NULL,
  CONSTRAINT fk_mt_room FOREIGN KEY (room_id)     REFERENCES rooms(id),
  CONSTRAINT fk_mt_open FOREIGN KEY (opened_by)   REFERENCES users(id),
  CONSTRAINT fk_mt_asg  FOREIGN KEY (assigned_to) REFERENCES users(id)
) ENGINE=InnoDB;

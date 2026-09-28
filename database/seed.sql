-- =====================================================================
-- CNAR MARGARITA - SEED DATA -> cnar_fvf
-- Roles, Superadmin, Camareras, Recepcionista y 54 habitaciones.
--
-- Passwords (bcrypt 10 rounds):
--   admin@cnar.gob.ve  -> Admin123*
--   maria@cnar.gob.ve  -> Limpia123*   (camarera)
--   jos@cnar.gob.ve    -> Limpia123*   (camarera)
--   ana@cnar.gob.ve    -> Limpia123*   (camarera)
--   recep@cnar.gob.ve  -> Recep123*    (recepcionista)
-- =====================================================================
USE cnar_fvf;

-- ROLES INICIALES
INSERT INTO roles (name, slug, description) VALUES
 ('Superadmin',                  'superadmin',          'Acceso total al sistema'),
 ('Coordinador de Recepcion',    'coord-reception',     'Supervisa recepcion y check-in'),
 ('Recepcionista',               'receptionist',        'Opera check-in / check-out'),
 ('Coordinador de Mantenimiento','coord-maintenance',   'Gestiona tickets de mantenimiento'),
 ('Camarera',                    'cleaning-staff',      'Personal de aseo');

-- USUARIOS (hashes bcrypt generados con 10 rounds)
INSERT INTO users (role_id, full_name, email, password_hash, staff_kind, is_active) VALUES
 (1, 'Wilman Superadmin', 'admin@cnar.gob.ve',
  '$2b$10$p7hzmy4u5yxHzV5R1V5eDO40TGt1DJ31e/zrNwrEBZE8YP/o94eHu',
  'SYSTEM', 1),
 (5, 'Maria Gonzalez',  'maria@cnar.gob.ve',
  '$2b$10$3Clv534PBrFgBJ27ylAICeUjMhh/pFcqUvM8BR6VJdVD/mp1Pp9um',
  'CLEANING', 1),
 (5, 'Josefina Perez',  'jos@cnar.gob.ve',
  '$2b$10$U6mVD6tVsBV8MQF4TO0TAOhr5CsRtIj6Y.AAnDbroONgfObmxXRCK',
  'CLEANING', 1),
 (5, 'Ana Rodriguez',   'ana@cnar.gob.ve',
  '$2b$10$Gt1XF4HyljU3BuG5MxhwIOOMkbQxkw8rjppchThoLITQRNAyUuy7K',
  'CLEANING', 1),
 (3, 'Lucia Hernandez', 'recep@cnar.gob.ve',
  '$2b$10$d6oGoj4IKRf9Y14812JQ.uNp8OXLpO1rq2.cHPEAKlZxuWz4bq.j.',
  'RECEPTION', 1);

-- =====================================================================
-- 54 HABITACIONES
--   Pisos 1-4 -> 12 STANDARD c/u = 48
--   Piso 5    ->  6 SUITE        =  6
-- =====================================================================
-- Piso 1
INSERT INTO rooms (room_number, floor, room_type, capacity, status) VALUES
 ('101',1,'STANDARD',3,'AVAILABLE'),('102',1,'STANDARD',3,'AVAILABLE'),
 ('103',1,'STANDARD',3,'AVAILABLE'),('104',1,'STANDARD',3,'AVAILABLE'),
 ('105',1,'STANDARD',3,'AVAILABLE'),('106',1,'STANDARD',3,'AVAILABLE'),
 ('107',1,'STANDARD',3,'AVAILABLE'),('108',1,'STANDARD',3,'AVAILABLE'),
 ('109',1,'STANDARD',3,'AVAILABLE'),('110',1,'STANDARD',3,'AVAILABLE'),
 ('111',1,'STANDARD',3,'AVAILABLE'),('112',1,'STANDARD',3,'AVAILABLE');
-- Piso 2
INSERT INTO rooms (room_number, floor, room_type, capacity, status) VALUES
 ('201',2,'STANDARD',3,'AVAILABLE'),('202',2,'STANDARD',3,'AVAILABLE'),
 ('203',2,'STANDARD',3,'AVAILABLE'),('204',2,'STANDARD',3,'AVAILABLE'),
 ('205',2,'STANDARD',3,'AVAILABLE'),('206',2,'STANDARD',3,'AVAILABLE'),
 ('207',2,'STANDARD',3,'AVAILABLE'),('208',2,'STANDARD',3,'AVAILABLE'),
 ('209',2,'STANDARD',3,'AVAILABLE'),('210',2,'STANDARD',3,'AVAILABLE'),
 ('211',2,'STANDARD',3,'AVAILABLE'),('212',2,'STANDARD',3,'AVAILABLE');
-- Piso 3
INSERT INTO rooms (room_number, floor, room_type, capacity, status) VALUES
 ('301',3,'STANDARD',3,'AVAILABLE'),('302',3,'STANDARD',3,'AVAILABLE'),
 ('303',3,'STANDARD',3,'AVAILABLE'),('304',3,'STANDARD',3,'AVAILABLE'),
 ('305',3,'STANDARD',3,'AVAILABLE'),('306',3,'STANDARD',3,'AVAILABLE'),
 ('307',3,'STANDARD',3,'AVAILABLE'),('308',3,'STANDARD',3,'AVAILABLE'),
 ('309',3,'STANDARD',3,'AVAILABLE'),('310',3,'STANDARD',3,'AVAILABLE'),
 ('311',3,'STANDARD',3,'AVAILABLE'),('312',3,'STANDARD',3,'AVAILABLE');
-- Piso 4
INSERT INTO rooms (room_number, floor, room_type, capacity, status) VALUES
 ('401',4,'STANDARD',3,'AVAILABLE'),('402',4,'STANDARD',3,'AVAILABLE'),
 ('403',4,'STANDARD',3,'AVAILABLE'),('404',4,'STANDARD',3,'AVAILABLE'),
 ('405',4,'STANDARD',3,'AVAILABLE'),('406',4,'STANDARD',3,'AVAILABLE'),
 ('407',4,'STANDARD',3,'AVAILABLE'),('408',4,'STANDARD',3,'AVAILABLE'),
 ('409',4,'STANDARD',3,'AVAILABLE'),('410',4,'STANDARD',3,'AVAILABLE'),
 ('411',4,'STANDARD',3,'AVAILABLE'),('412',4,'STANDARD',3,'AVAILABLE');
-- Piso 5 -> 6 SUITES
INSERT INTO rooms (room_number, floor, room_type, capacity, status) VALUES
 ('501',5,'SUITE',3,'AVAILABLE'),('502',5,'SUITE',3,'AVAILABLE'),
 ('503',5,'SUITE',3,'AVAILABLE'),('504',5,'SUITE',3,'AVAILABLE'),
 ('505',5,'SUITE',3,'AVAILABLE'),('506',5,'SUITE',3,'AVAILABLE');

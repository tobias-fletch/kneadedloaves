-- Reset admin password for kneadedloaves@gmail.com
-- Run this in Neon SQL Editor, then log in with the new password
UPDATE "User" SET "passwordHash" = '$2a$12$295wolJykPMoKpPl2XN7sebohb2GG3KyrZ/Bc1KPHaYLwLS6qmAyq', "role" = 'ADMIN', "updatedAt" = now() WHERE "email" = 'kneadedloaves@gmail.com';

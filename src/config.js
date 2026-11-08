import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://clinic:clinic@localhost:5433/clinic',
  jwtSecret: process.env.JWT_SECRET || 'harborlight-demo-secret',
  clinicTz: process.env.CLINIC_TZ || 'Africa/Kigali',
  clinicName: process.env.CLINIC_NAME || 'Harborlight Clinic',
  currency: process.env.CLINIC_CURRENCY || 'RWF',
};

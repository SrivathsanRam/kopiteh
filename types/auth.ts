export type UserRole = "admin" | "runner" | "user";

export interface CreateAccountPayload {
  name: string;
  email: string;
  password: string;
  secretCode: string;
}

export interface User {
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  created_at: string; // ISO
}

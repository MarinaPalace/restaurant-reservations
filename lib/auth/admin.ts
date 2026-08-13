import bcrypt from "bcryptjs";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ?? bcrypt.hashSync("admin123", 10);

export function verifyAdminCredentials(username: string, password: string) {
  if (!username || !password) {
    return false;
  }

  if (username !== ADMIN_USERNAME) {
    return false;
  }

  return bcrypt.compareSync(password, ADMIN_PASSWORD_HASH);
}

export function getAdminConfig() {
  return {
    username: ADMIN_USERNAME,
    passwordHash: ADMIN_PASSWORD_HASH,
  };
}

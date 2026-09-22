import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString("hex");
export async function passwordHash(
  password,
  salt = randomBytes(16).toString("hex"),
) {
  return { salt, hash: (await derive(password, salt, 64)).toString("hex") };
}
export async function verifyPassword(password, stored) {
  const candidate = await passwordHash(password, stored.salt);
  return timingSafeEqual(
    Buffer.from(candidate.hash, "hex"),
    Buffer.from(stored.hash, "hex"),
  );
}

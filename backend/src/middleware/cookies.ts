import { Response } from "express";

export function appendSetCookie(res: Response, value: string) {
  const current = res.getHeader("Set-Cookie");
  const cookies = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
  res.setHeader("Set-Cookie", [...cookies, value]);
}

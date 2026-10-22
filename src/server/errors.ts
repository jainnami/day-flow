export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function publicError(error: unknown): { message: string; status: number } {
  if (error instanceof AppError) return { message: error.message, status: error.status };
  // Never forward raw database, Google, or configuration errors to the browser.
  return { message: "The request could not finish. Check your connection and server setup, then retry the same submission.", status: 500 };
}

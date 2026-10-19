import { NextFunction, Request, Response } from "express-serve-static-core";
import client from "prom-client";

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
});

export function metricsMiddleware(request: Request, response: Response, next: NextFunction) {
  const stopTimer = httpRequestDuration.startTimer();
  response.on("finish", () => {
    stopTimer({ method: request.method, route: request.route?.path ?? "unmatched", status_code: response.statusCode });
  });
  next();
}

export async function metricsHandler(request: Request, response: Response) {
  response.set("Content-Type", client.register.contentType);
  return response.send(await client.register.metrics());
}

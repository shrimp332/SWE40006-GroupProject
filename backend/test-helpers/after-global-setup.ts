import { app } from "../src/app";
import request from "supertest";
import http from "http";
import { testDatabase } from "../src/config/database.config";

const PORT = 0;

const express = app(testDatabase);
const server = http.createServer(express).listen(PORT);
export const superRequestAgent = request(server);

afterAll(async () => {
  console.log("AFTER-ALL GLOBAL SETUP");
  await testDatabase.destroy();
  server.close();
});

// Unit tests: env only. Point DATABASE_URL at the test DB anyway so a stray import can never reach dev.
import { selectTestDatabase } from "./env";
selectTestDatabase();

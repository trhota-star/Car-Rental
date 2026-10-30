// Integration tests: test DB only. Must run before any import of "@/lib/db".
import { selectTestDatabase } from "./env";
selectTestDatabase();

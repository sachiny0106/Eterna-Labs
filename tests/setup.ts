// Test environment setup
process.env.NODE_ENV = 'test';
process.env.USE_MEMORY_CACHE = 'true';
process.env.LOG_LEVEL = 'error';
process.env.CACHE_TTL = '5';
process.env.PORT = '3001'; // Valid port for tests

jest.setTimeout(30000);

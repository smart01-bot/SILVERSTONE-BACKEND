# Float System Management Platform - Technical Documentation

![Node.js](https://img.shields.io/badge/Node.js-v18.x-green)
![Express.js](https://img.shields.io/badge/Express.js-v4.x-blue)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-v15-blue)
![Supabase](https://img.shields.io/badge/Supabase-Hosted-brightgreen)
![Redis](https://img.shields.io/badge/Redis-Cloud-red)

render (https://silverstone-backend.onrender.com)

The **Float System Management Platform** is a robust Node.js-based backend for managing mobile money float requests, transfers, and analytics for agents across networks like Vodacom, Tigo, Yas, and Halotel. It provides secure APIs for agent management, request submission, queue processing, transaction handling, and analytics, with role-based access control (admin, main-agent, sub-agent).

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Technologies](#technologies)
- [Setup Instructions](#setup-instructions)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [Authentication](#authentication)
- [Queue Management](#queue-management)
- [Testing](#testing)
- [Deployment](#deployment)
- [Error Handling](#error-handling)
- [Security](#security)
- [Future Improvements](#future-improvements)
- [Support](#support)

## Overview

This backend powers a mobile money float management system, enabling agents to submit float requests, process transfers, and access analytics. It uses **Express.js** for routing, **Supabase** (PostgreSQL) for data storage, **Redis Cloud** for priority queue management, and **JWT** for authentication. Key features include:

- Agent registration and role-based access.
- Float request submission with priority queuing.
- Transaction processing with external API integration.
- Comprehensive analytics for performance tracking.

## Architecture

### Components

- **Express.js Server**: Handles HTTP requests and routes to controllers.
- **Supabase (PostgreSQL)**: Cloud-hosted database for storing agents, requests, and transactions.
- **Redis Cloud**: Manages a priority queue (`float_queue`) for urgent requests.
- **Controllers**: Implement business logic for authentication, agents, requests, transfers, and analytics.
- **Middleware**: Enforces JWT authentication and admin restrictions.
- **Services**: Handle queue operations and transfer processing.
- **Models**: Manage database CRUD operations.
- **Utilities**: Define constants (e.g., `ROLES`, `NETWORKS`).

### Directory Structure

```plaintext
float-system-backend/
├── src/
│   ├── config/
│   │   ├── database.js      # Supabase PostgreSQL connection
│   │   ├── redis.js         # Redis Cloud connection
│   ├── controllers/
│   │   ├── authController.js      # Authentication logic
│   │   ├── agentController.js     # Agent management
│   │   ├── requestController.js   # Float request handling
│   │   ├── transferController.js  # Transfer processing
│   │   ├── dashboardController.js # Analytics and dashboard metrics
│   ├── middleware/
│   │   ├── auth.js           # JWT verification
│   │   ├── errorHandler.js   # Global error handling
│   ├── models/
│   │   ├── agent.js         # Agent CRUD
│   │   ├── request.js       # Request CRUD
│   │   ├── transaction.js   # Transaction CRUD
│   ├── routes/
│   │   ├── authRoutes.js    # Authentication endpoints
│   │   ├── agentRoutes.js   # Agent endpoints
│   │   ├── requestRoutes.js # Request endpoints
│   │   ├── transferRoutes.js # Transfer endpoints
│   │   ├── dashboardRoutes.js # Analytics endpoints
│   ├── services/
│   │   ├── queueService.js  # Redis queue operations
│   │   ├── transferService.js # Transfer logic
│   ├── utils/
│   │   ├── constants.js     # ROLES and NETWORKS
│   ├── index.js             # Application entry point
├── tests/
│   ├── auth.test.cjs        # Authentication tests
│   ├── request.test.cjs     # Request tests
│   ├── queue.test.cjs       # Queue tests
│   ├── transfer.test.cjs    # Transfer tests
│   ├── analytics.test.cjs   # Analytics tests
├── .env                    # Environment variables
├── setup.sql               # Supabase schema
├── jest.config.cjs         # Jest configuration
├── .eslintrc.json          # ESLint configuration
├── .prettierrc             # Prettier configuration
├── Dockerfile              # Docker setup
├── README.md               # This file

```
## Technologies

- **Node.js**: v18.x
- **Express.js**: v4.x for routing
- **PostgreSQL**: v15 for data storage
- **Redis Cloud**: For priority queue management
- **JWT**: For authentication
- **bcrypt**: For password hashing
- **express-validator**: For input validation
- **axios**: For external API calls (mocked in tests)
- **pg-promise**: Database client for Supabase 
- **Jest & Supertest**: For unit and integration testing

## Setup Instructions
Prerequisites

- **Node.js**: v18.x (node -v to verify)
- **Supabase Account**: Sign up at supabase.com
- **Redis Cloud Account**: Obtain credentials from Redis Cloud
- **Postman**: For API testing
- **Git**: For cloning the repository

## Installation

1. **Clone Repository**:

   ```bash
   git clone https://github.com/mixro/svc-backend
   cd svc-backend
   ```
2. **Install Dependencies**:

   ```bash
   npm install
   ```

3. **Configure Environment**:
   - Create `.env` in the root directory:

     ```plaintext
     DB_HOST=localhost
     DB_PORT=5432
     DB_NAME=your_database_name
     DB_USER=your_database_username
     DB_PASSWORD=your_database_password
     DATABASE_URL=postgresql://postgres.[project-ref]:[password]@db.[project-ref].supabase.co:6543/postgres?pgbouncer=true
     REDIS_USERNAME=your_redis_username
     REDIS_PASSWORD=your_redis_password
     REDIS_HOST=your_redis_host
     REDIS_PORT=15112
     MPESA_API_KEY=your_key
     TIGO_API_KEY=your_key
     JWT_SECRET=your_jwt_secret
     PORT=8800
     ```
   - Replace `your_jwt_secret`, `MPESA_API_KEY`, and `TIGO_API_KEY` with secure values.


    - Obtain DATABASE_URL from Supabase Dashboard (Settings > Database > Connection Info).
    - Replace other values with secure credentials.


4. **Set Up Supabase Database**:

    - Create a new Supabase project:

      ```plaintext
      -Go to supabase.com, create a project, and note the project reference and password.

      -Use the pooled connection string (port 6543) for high concurrency.    
      ```


    - Run the schema in Supabase’s SQL Editor:
      ```bash
        psql -h db.[project-ref].supabase.co -U postgres -d postgres -f setup.sql

        Or paste setup.sql contents into the SQL Editor and run.
      ```


5. **Verify Redis Connection**:

      ```bash
        your_redis_host
      ```
    - Run `PING` (should return `PONG`)


6. **Start Server**:

   ```bash
   npm start
   ```
   - Server runs at `http://localhost:8800`.



## Database Schema
The setup.sql creates three tables in Supabase (PostgreSQL):

- **agents**:

  ```sql
  CREATE TABLE agents (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      username VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      networks VARCHAR(50)[] NOT NULL,
      agentPhoneNumbers VARCHAR(20)[] NOT NULL,
      role VARCHAR(255) NOT NULL,
      createdat TIMESTAMP DEFAULT NOW()
  );
  ```

- **requests**:

  ```sql
  CREATE TABLE requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sub_agent_id UUID REFERENCES agents(id),
    subagent_name VARCHAR(255) NOT NULL,
    requested_network VARCHAR(50),
    source_network VARCHAR(50),
    requested_phoneNumber VARCHAR(20),
    source_phoneNumber VARCHAR(20),
    amount DECIMAL(15, 2),
    urgency BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
  );
  ```

- **transactions**:
  ```sql
  CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES requests(id),
    amount DECIMAL(15, 2),
    subagent_name VARCHAR(255),
    source_network VARCHAR(50),
    destination_network VARCHAR(50),
    destination_phoneNumber VARCHAR(20),
    source_phoneNumber VARCHAR(20),
    status VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW()
  );
  ```


- **Permissions:**
  ```sql
  GRANT ALL ON TABLE agents, requests, transactions TO postgres;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres;
  ```



## API Endpoints
- All endpoints require Authorization: 
  ```plaintext
  Bearer <token> unless specified. Admin-only endpoints require role: 'admin' in the JWT payload.
  ```
### 1. Authentication (/api/auth)

- **POST /register**
  - Description: Registers a new agent and returns a JWT token.
  - Body:

    ```json
    {
    "username": "Example Name",
    "email": "examplename@gmail.com",
    "phone": "0334232",
    "networks": ["Halotel", "Yas"],
    "agentPhoneNumbers": ["075555666", "078888999"],
    "role": "sub-agent",
    "password": "strongPassword"
    }
    ```
  - Response: `201` with `{ agent }`
- **POST /login**
  - Description: Authenticates an agent and returns a JWT token.
  - Body:

    ```json
    {
      "email": "examplename@gmail.com",
      "password":"strongPassword"
    }
    ```
  - Response: `200` with `{ agent }`
- **POST /logout**
  - Description: Log out a user.
  - Body:

    ```json
    {
      "email": "examplename@gmail.com",
      "password":"strongPassword"
    }
    ```
  - Response: `200` with `""Logged out""`


### 2. Agents (/api/agents)

- **GET /**
  - Description: Retrieves all agents (admin-only).
  - Body: None
  - Response: `200` with 
    ```plaintext
    { agents: [{ id, username, phone, network, role, created_at }, ...] }
    ```

- **GET /:id**
  - Description: Retrieves a single agent by ID.
  - Body: None
  - Response: `200` with 
    ```plaintext
    { agent: { id, username, phone, network, role, created_at } }
    ```

- **PUT /:id**
  - Description: Updates an agent’s details (admin-only).
  - Body:
    ```plaintext
    {
      "username": "Updated Agent",
      "phone": "9876543210",
      "network": "Tigo",
      "role": "main-agent",
      "password": "newpassword"
    }
    ```
  - Response: `200` with `{ agent }`

- **DELETE /:id**
  - Description: Deletes an agent (admin-only).
  - Body: None
  - Response: `204 No Content`

### 3. Requests (/api/requests)

- **POST /submit**
  - Description: Submits a float request and adds it to the Redis queue.
  - Body:
    ```json
    {
      "subAgentId": "uuid",
      "subagent_name": "example",
      "requested_network": "Yas",
      "source_network":"Yas",
      "source_phoneNumber":"3904845",
      "requested_phoneNumber":"2343465",
      "amount": 128000,
      "urgency":false
    }
    ```
  - Response: `201` with `{ request, queuePosition }`

- **GET /**
  - Description: Retrieves all requests (admin-only).
  - Body: None
  - Response: `200` with 
    ```plaintext
    { requests: [{ id, sub_agent_id, requested_network, source_network, amount, urgency, status, created_at }, ...] }
    ```

- **GET /:id**
  - Description: Retrieves a single request by ID.
  - Body: None
  - Response: `200` with `{ request }`

- **PUT /:id**
  - Description: Updates a request’s details.
  - Body:
    ```json
    {
      "requestedNetwork": "Tigo",
      "sourceNetwork": "Vodacom",
      "amount": 200000,
      "urgency": false,
      "status": "approved"
    }
    ```
  - Response: `200` with `{ request }`

- **DELETE /:id**
  - Description: Deletes a request and removes it from the Redis queue (admin-only).
  - Body: None
  - Response: `204 No Content`

### 4. Transfers (/api/transfers)

- **POST /process**
  - Description: Processes a float request, creating a transaction.
  - Body:
    ```json
    {
      "requestId": "uuid",
      "subagent_name": "example",
      "destination_network": "Yas",
      "source_network":"Yas",
      "source_phoneNumber":"3904845",
      "destination_phoneNumber":"2343465",
      "amount": 128000,
      "urgency":false
    }
    ```
  - Response: `200` with `{ status, request }`

- **GET /**
  - Description: Retrieves all transactions (admin-only).
  - Body: None
  - Response: `200` with 
  ```plaintext
  { transfers: [{ id, request_id, amount, source_network, destination_network, status, created_at }, ...] }
  ```

- **GET /:id**
  - Description: Retrieves a single transaction by ID.
  - Body: None
  - Response: `200` with `{ transfer }`

- **PUT /:id**
  - Description: Updates a transaction’s details.
  - Body:
    ```json
    {
      "amount": 150000,
      "sourceNetwork": "Vodacom",
      "destinationNetwork": "Tigo",
      "status": "completed"
    }
    ```
  - Response: `200` with `{ transfer }`

- **DELETE /:id**
  - Description: Deletes a transaction (admin-only).
  - Body: None
  - Response: `204 No Content`

### 5. Dashboard (/api/dashboard)

- **GET /revenue-metrics**
  - Description: Retrieves revenue, requests, transactions, and sub-agents with month-over-month percentages (admin-only).
  - Body: None
  - Response: `200` with 
    ```
    { revenue, revenuePercentage, requests, requestsPercentage, transactions, transactionsPercentage, subAgents, subAgentsPercentage, totalRequests, totalTransactions, totalSubAgents }
    ```

- **GET /monthly-counts**
  - Description: Retrieves request and transaction counts for the last 7 months (admin-only).
  - Body: None
  - Response: `200` with 
    ```
    [{ month, requests, transactions }, ...]
    ```

- **GET /performance-metrics**
  - Description: Retrieves success rate, average amounts, and aging metrics (admin-only).
  - Body: None
  - Response: `200` with 
    ```
    { successRate, averageTransactionAmount, averageRequestAmount, pendingRequestAging, pendingTransactionAging }
    ```

- **GET /requests-per-network**
  - Description: Retrieves requests by network with rankings and percentages (admin-only).
  - Body: None
  - Response: `200` with 
    ```
    [{ network, count, percentageChange }, ...]
    ```

- **GET /top-agents**
  - Description: Retrieves top 10 agents by request amount (admin-only).
  - Body: None
  - Response: `200` with
    ```
    [{ id, username, requests, requestAmount }, ...]
    ```
### 6. Real-Time Updates (/api/sse)

- **GET /sse (Admin-only)**
  - Streams real-time dashboard data using Server-Sent Events (SSE).
  
  - Response: Stream of events:

  connected: 
    ```json
      { "message": "Connected to dashboard updates" }
    ```

  dashboard: 
  ```plaintext
    revenueMetrics: {
      // revenue
      currentRevenue,
      previousRevenue,
      revenuePercentage,
      totalRevenue,

      // requests
      dailyRequestsCount,
      currentRequests,
      previousRequests,
      requestsPercentage,
      totalRequests,

      // transactions
      dailyTransactionsCount,
      currentTransactions,
      previousTransactions,
      transactionsPercentage,
      totalTransactions,

      // subagents
      dailyAgentsCount,
      currentSubAgents,
      previousSubAgents,
      subAgentsPercentage,
      totalSubAgents
      }
  ```
  error: 
    ```json
    { "error": "Failed to fetch dashboard data" }
    ```

## Authentication

- **JWT**: Tokens are issued via `/api/auth/register` or `/api/auth/login` and include `id` and `role` (`sub-agent`, `main-agent`, or `admin`).
- **Middleware**: The `auth` middleware verifies tokens. Admin-only routes use `auth(true)` to restrict access to `role: 'admin'`.
- **Usage**: Include `Authorization: Bearer <token>` in headers.

## Queue Management

- **Redis Queue**: Uses a sorted set (`float_queue`) with priority scores (timestamp + 1,000,000 for urgent requests).
- **Operations**:
  - `addToQueue`: Adds request ID with priority score.
  - `getQueuePosition`: Retrieves queue position.
  - `getNextRequest`: Fetches and removes the highest-priority request.

## Testing

### Setup

1. Create `jest.config.cjs`:

   ```javascript
   module.exports = {
     testEnvironment: 'node',
     testMatch: ['**/*.test.cjs'],
     moduleFileExtensions: ['js', 'cjs'],
     transform: {},
   };
   ```
2. Install dependencies:

   ```bash
   npm install
   ```
3. Run tests:

   ```bash
   npm test
   ```
   - Tests cover authentication, requests, queue, transfers, and analytics.
   - Coverage report: `coverage/lcov-report/index.html`.

### Test Files

- `auth.test.cjs`: Tests `POST /api/auth/register` and `POST /api/auth/login`.
- `request.test.cjs`: Tests `POST /api/requests/submit`.
- `queue.test.cjs`: Tests Redis queue operations.
- `transfer.test.cjs`: Tests `POST /api/transfers/process`.
- `analytics.test.cjs`: Tests `GET /api/analytics/agent/:agentId`.

### Manual Testing

Use Postman with the provided collection (`float-system-backend-postman-collection.json`):

1. Import collection into Postman.
2. Set environment variables:
   - `baseUrl`: `http://localhost:3000`
   - `jwtToken`: Set dynamically by register/login responses.
3. Run requests in order: Register, Submit Request, Process Transfer.

## Deployment

### Local

- Start server:

  ```bash
  npm start
  ```
- Access at `http://localhost:3000`.

### Docker

1. Build image:

   ```bash
   docker build -t float-system-backend .
   ```
2. Run container:

   ```bash
   docker run -p 3000:3000 --env-file .env float-system-backend
   ```

## Error Handling

- **400 Bad Request**: Invalid input (e.g., missing fields, invalid network).
- **401 Unauthorized**: Missing or invalid JWT token.
- **403 Forbidden**: Non-admin access to admin-only routes.
- **404 Not Found**: Resource (e.g., agent, request) not found.
- **500 Internal Server Error**: Database, Redis, or other server errors.

## Security

- **Password Hashing**: Uses `bcrypt` with 10 rounds.
- **Input Validation**: `express-validator` ensures valid inputs.
- **Role-Based Access**: Admin-only routes restrict sensitive operations.
- **JWT**: Tokens expire after 1 hour.

## Future Improvements

- Add rate limiting to prevent abuse.
- Implement transaction retry mechanism for failed API calls.
- Add logging for audit trails.
- Expand analytics with filters (e.g., date range, network).

## Support

For issues, check logs in `console` or contact the development team. Provide error messages, request payloads, and server logs for debugging.


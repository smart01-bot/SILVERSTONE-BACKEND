import bcrypt from 'bcrypt';
import dotenv from "dotenv";
dotenv.config({quiet: true});
import jwt from 'jsonwebtoken';
import { check, validationResult } from 'express-validator';
import { createAgent, getAgentByEmail } from '../models/agent.js';
import { ROLES, NETWORKS } from '../utils/constants.js';

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    await Promise.all([
      check('email').isEmail().run(req),
      check('password').isString().notEmpty().run(req),
    ]);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const agent = await getAgentByEmail(email);
    if (!agent) return res.status(401).json({ error: 'Invalid credentials' });

    const isValid = await bcrypt.compare(password, agent.passwordhash);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

    const accessToken = jwt.sign(
      { id: agent.id, 
        role: agent.role 
      }, 
      process.env.JWT_SECRET, { expiresIn: '24h' }
    );

    res.cookie("accessToken", accessToken,  {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000
    })

    const { passwordhash, ...agentWithoutPassword } = agent;
    res.status(200).json({ ...agentWithoutPassword });
  } catch (error) {
    next(error);
  }
};

const register = async (req, res, next) => {
  try {
    const { username, email, phone, networks, agentPhoneNumbers, role, password } = req.body;

    // Validation
    await Promise.all([
      check('username').isString().notEmpty().run(req),
      check('email').isString().notEmpty().run(req),
      check('phone').isString().notEmpty().run(req),
      check('networks').isArray().custom((arr) => arr.every(n => NETWORKS.includes(n))).run(req),
      check('agentPhoneNumbers').isArray().custom((arr) => arr.every(p => typeof p === 'string')).run(req),
      check('role').isString().isIn(ROLES).run(req),
      check('password').isString().isLength({ min: 6 }).run(req),
    ]);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const agent = await createAgent(username, email, phone, networks, agentPhoneNumbers, role, passwordHash).catch((error) => {
      throw error; // Propagate custom error object to middleware
    });

    const accessToken = jwt.sign
    ({ id: agent.id, role: agent.role }, 
      process.env.JWT_SECRET, { expiresIn: '12h' }
    );

    res.cookie("accessToken", accessToken,  {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 12 * 60 * 60 * 1000
    })

    const { passwordhash, ...agentWithoutPassword } = agent;

    res.status(201).json({ ...agentWithoutPassword });
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res) => {
  res.clearCookie("accessToken", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
  });
  res.status(200).json("Logged out");
}

export { login, register, logout };
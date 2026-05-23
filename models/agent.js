import db from '../config/database.js';
import { ROLES } from '../utils/constants.js';

const createAgent = async (
  username, name, email, phone,
  networks, agentPhoneNumbers, role, passwordHash,
  businessName, businessLocation, coordinates,
  regNo, tin, nida, floatCapacity,
  tinCertUrl, licenceCertUrl, selfieVerified
) => {
  if (!ROLES.includes(role)) {
    return Promise.reject({ status: 400, message: 'Invalid role' });
  }
  const existingPhone = await db.oneOrNone('SELECT id FROM agents WHERE phone = $1', [phone]);
  if (existingPhone) {
    return Promise.reject({ status: 409, message: 'Phone number already registered' });
  }
  const existingEmail = await db.oneOrNone('SELECT id FROM agents WHERE email = $1', [email]);
  if (existingEmail) {
    return Promise.reject({ status: 409, message: 'Email already registered' });
  }
  return db.one(
    `INSERT INTO agents (
       username, name, email, phone,
       networks, agentphonenumbers, role, passwordhash,
       status, pin_set,
       business_name, business_location, coordinates,
       reg_no, tin, nida, float_capacity,
       tin_cert_url, licence_cert_url, selfie_verified
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,
       'pending', FALSE,
       $9,$10,$11,$12,$13,$14,$15,$16,$17,$18
     ) RETURNING *`,
    [
      username, name ?? username, email, phone,
      networks, agentPhoneNumbers, role, passwordHash,
      businessName, businessLocation, coordinates,
      regNo, tin, nida, floatCapacity ?? 0,
      tinCertUrl, licenceCertUrl, selfieVerified ?? false,
    ]
  );
};

const getAgentByPhone  = (phone)  => db.oneOrNone('SELECT * FROM agents WHERE phone = $1',    [phone]);
const getAgentByName   = (username) => db.oneOrNone('SELECT * FROM agents WHERE username = $1', [username]);
const getAgentByEmail  = (email)  => db.oneOrNone('SELECT * FROM agents WHERE email = $1',    [email]);
const getAgent         = (id)     => db.oneOrNone('SELECT * FROM agents WHERE id = $1',       [id]);
const getAllAgents      = ()       => db.manyOrNone('SELECT * FROM agents');

const updateAgentData = async (id, fields) => {
  const allowed = [
    'username','name','email','phone','networks','agentphonenumbers',
    'role','passwordhash','status','pin_set',
    'business_name','business_location','coordinates',
    'reg_no','tin','nida','float_capacity',
    'tin_cert_url','licence_cert_url','selfie_verified',
  ];

  const updates = [];
  const values  = [id];
  let   index   = 2;

  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key) && val !== undefined) {
      updates.push(`${key} = $${index++}`);
      values.push(val);
    }
  }

  if (updates.length === 0) {
    return Promise.reject({ status: 400, message: 'No fields to update' });
  }

  return db.one(`UPDATE agents SET ${updates.join(', ')} WHERE id = $1 RETURNING *`, values);
};

const deleteAgent = (id) => db.none('DELETE FROM agents WHERE id = $1', [id]);

const getAgentRequestsData = (id) =>
  db.manyOrNone('SELECT * FROM requests WHERE sub_agent_id = $1 ORDER BY created_at DESC', [id]);

const getAgentTransactionsData = (id) =>
  db.manyOrNone(
    'SELECT t.* FROM transactions t JOIN requests r ON t.request_id = r.id WHERE r.sub_agent_id = $1 ORDER BY t.created_at DESC',
    [id]
  );

export {
  createAgent, getAgentByPhone, getAgentByName, getAgentByEmail,
  getAgent, getAllAgents, updateAgentData, deleteAgent,
  getAgentRequestsData, getAgentTransactionsData,
};
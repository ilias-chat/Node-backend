const User = require('../models/User');

function formatUser(doc) {
  const o = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
  if (!o) return null;
  return {
    id: o._id.toString(),
    firebaseUID: o.firebaseUID,
    email: o.email,
    role: o.role,
    name: o.name,
    avatar: o.avatar,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function sync(req, res, next) {
  try {
    const { firebaseUID, email, name, avatar } = req.body || {};
    if (!firebaseUID || typeof firebaseUID !== 'string') {
      return res.status(400).json({ error: 'firebaseUID is required' });
    }
    if (firebaseUID !== req.firebase.uid) {
      return res.status(403).json({ error: 'firebaseUID does not match token' });
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }

    const set = {
      email: email.trim().toLowerCase(),
    };
    if (name !== undefined) {
      if (name === null) {
        // omit — do not assign null (Mongoose String cast error)
      } else if (typeof name === 'string') {
        set.name = name.trim();
      } else {
        return res.status(400).json({ error: 'name must be a string when provided' });
      }
    }
    if (avatar !== undefined) {
      if (avatar === null || avatar === '') {
        set.avatar = '';
      } else if (typeof avatar === 'string') {
        set.avatar = avatar.trim();
      } else {
        return res.status(400).json({ error: 'avatar must be a string, null, or empty string' });
      }
    }

    const user = await User.findOneAndUpdate(
      { firebaseUID },
      {
        $set: set,
        $setOnInsert: { firebaseUID },
      },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json(formatUser(user));
  } catch (err) {
    next(err);
  }
}

function login(req, res) {
  res.json(formatUser(req.mongoUser));
}

function getMe(req, res) {
  res.json(formatUser(req.mongoUser));
}

async function updateProfile(req, res, next) {
  try {
    const { uid } = req.params;
    if (uid !== req.firebase.uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, avatar } = req.body || {};
    const set = {};
    if (name !== undefined) {
      if (name === null) {
        // omit
      } else if (typeof name === 'string') {
        set.name = name.trim();
      } else {
        return res.status(400).json({ error: 'name must be a string when provided' });
      }
    }
    if (avatar !== undefined) {
      if (avatar === null || avatar === '') {
        set.avatar = '';
      } else if (typeof avatar === 'string') {
        set.avatar = avatar.trim();
      } else {
        return res.status(400).json({ error: 'avatar must be a string, null, or empty string' });
      }
    }
    if (Object.keys(set).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const user = await User.findOneAndUpdate(
      { firebaseUID: uid },
      { $set: set },
      { new: true, runValidators: true }
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(formatUser(user));
  } catch (err) {
    next(err);
  }
}

async function listUsers(req, res, next) {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    return res.json(users.map((u) => formatUser(u)));
  } catch (err) {
    next(err);
  }
}

async function patchRole(req, res, next) {
  try {
    const { uid } = req.params;
    const { role } = req.body || {};
    if (role !== 'user' && role !== 'admin') {
      return res.status(400).json({ error: 'role must be user or admin' });
    }
    if (req.mongoUser.firebaseUID === uid && req.mongoUser.role === 'admin' && role === 'user') {
      return res.status(400).json({ error: 'Cannot demote yourself' });
    }

    const user = await User.findOneAndUpdate(
      { firebaseUID: uid },
      { $set: { role } },
      { new: true, runValidators: true }
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json(formatUser(user));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  sync,
  login,
  getMe,
  updateProfile,
  listUsers,
  patchRole,
};

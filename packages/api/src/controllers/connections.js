const path = require('path');
const { fork } = require('child_process');
const _ = require('lodash');
const nedb = require('nedb-promises');
const fs = require('fs-extra');

const { datadir, filesdir } = require('../utility/directories');
const socket = require('../utility/socket');
const { encryptConnection } = require('../utility/crypting');
const { handleProcessCommunication } = require('../utility/processComm');

function getNamedArgs() {
  const res = {};
  for (let i = 0; i < process.argv.length; i++) {
    const name = process.argv[i];
    if (name.startsWith('--')) {
      let value = process.argv[i + 1];
      if (value && value.startsWith('--')) value = null;
      res[name.substring(2)] = value == null ? true : value;
      i++;
    } else {
      if (name.endsWith('.db') || name.endsWith('.sqlite') || name.endsWith('.sqlite3')) {
        res.databaseFile = name;
        res.engine = 'sqlite@dbgate-plugin-sqlite';
      }
    }
  }
  return res;
}

function getDatabaseFileLabel(databaseFile) {
  if (!databaseFile) return databaseFile;
  const m = databaseFile.match(/[\/]([^\/]+)$/);
  if (m) return m[1];
  return databaseFile;
}

function getPortalCollections() {
  if (process.env.CONNECTIONS) {
    return _.compact(process.env.CONNECTIONS.split(',')).map(id => ({
      _id: id,
      engine: process.env[`ENGINE_${id}`],
      server: process.env[`SERVER_${id}`],
      user: process.env[`USER_${id}`],
      password: process.env[`PASSWORD_${id}`],
      port: process.env[`PORT_${id}`],
      databaseUrl: process.env[`URL_${id}`],
      databaseFile: process.env[`FILE_${id}`],
      defaultDatabase: process.env[`DATABASE_${id}`],
      singleDatabase: !!process.env[`DATABASE_${id}`],
      displayName: process.env[`LABEL_${id}`],
    }));
  }

  const args = getNamedArgs();
  if (args.databaseFile) {
    return [
      {
        _id: 'argv',
        databaseFile: args.databaseFile,
        singleDatabase: true,
        defaultDatabase: getDatabaseFileLabel(args.databaseFile),
        engine: args.engine,
      },
    ];
  }
  if (args.databaseUrl) {
    return [
      {
        _id: 'argv',
        useDatabaseUrl: true,
        ...args,
      },
    ];
  }
  if (args.server) {
    return [
      {
        _id: 'argv',
        ...args,
      },
    ];
  }

  return null;
}
const portalConnections = getPortalCollections();

function getSingleDatabase() {
  if (process.env.SINGLE_CONNECTION && process.env.SINGLE_DATABASE) {
    // @ts-ignore
    const connection = portalConnections.find(x => x._id == process.env.SINGLE_CONNECTION);
    return {
      connection,
      name: process.env.SINGLE_DATABASE,
    };
  }
  // @ts-ignore
  const arg0 = (portalConnections || []).find(x => x._id == 'argv');
  if (arg0) {
    // @ts-ignore
    if (arg0.singleDatabase) {
      return {
        connection: arg0,
        // @ts-ignore
        name: arg0.defaultDatabase,
      };
    }
  }
  return null;
}

const singleDatabase = getSingleDatabase();

module.exports = {
  datastore: null,
  opened: [],
  singleDatabase,
  portalConnections,

  async _init() {
    const dir = datadir();
    if (!portalConnections) {
      // @ts-ignore
      this.datastore = nedb.create(path.join(dir, 'connections.jsonl'));
    }
  },

  list_meta: 'get',
  async list() {
    return portalConnections || this.datastore.find();
  },

  test_meta: {
    method: 'post',
    raw: true,
  },
  test(req, res) {
    const subprocess = fork(process.argv[1], ['--start-process', 'connectProcess', ...process.argv.slice(3)]);
    subprocess.on('message', resp => {
      if (handleProcessCommunication(resp, subprocess)) return;
      // @ts-ignore
      const { msgtype } = resp;
      if (msgtype == 'connected' || msgtype == 'error') {
        res.json(resp);
      }
    });
    subprocess.send(req.body);
  },

  save_meta: 'post',
  async save(connection) {
    if (portalConnections) return;
    let res;
    const encrypted = encryptConnection(connection);
    if (connection._id) {
      res = await this.datastore.update(_.pick(connection, '_id'), encrypted);
    } else {
      res = await this.datastore.insert(encrypted);
    }
    socket.emitChanged('connection-list-changed');
    return res;
  },

  update_meta: 'post',
  async update({ _id, values }) {
    if (portalConnections) return;
    const res = await this.datastore.update({ _id }, { $set: values });
    socket.emitChanged('connection-list-changed');
    return res;
  },

  updateDatabase_meta: 'post',
  async updateDatabase({ conid, database, values }) {
    if (portalConnections) return;
    const conn = await this.datastore.find({ _id: conid });
    let databases = conn[0].databases || [];
    if (databases.find(x => x.name == database)) {
      databases = databases.map(x => (x.name == database ? { ...x, ...values } : x));
    } else {
      databases = [...databases, { name: database, ...values }];
    }
    const res = await this.datastore.update({ _id: conid }, { $set: { databases } });
    socket.emitChanged('connection-list-changed');
    return res;
  },

  delete_meta: 'post',
  async delete(connection) {
    if (portalConnections) return;
    const res = await this.datastore.remove(_.pick(connection, '_id'));
    socket.emitChanged('connection-list-changed');
    return res;
  },

  get_meta: 'get',
  async get({ conid }) {
    if (portalConnections) return portalConnections.find(x => x._id == conid);
    const res = await this.datastore.find({ _id: conid });
    return res[0];
  },

  newSqliteDatabase_meta: 'post',
  async newSqliteDatabase({ file }) {
    const sqliteDir = path.join(filesdir(), 'sqlite');
    if (!(await fs.exists(sqliteDir))) {
      await fs.mkdir(sqliteDir);
    }
    const databaseFile = path.join(sqliteDir, `${file}.sqlite`);
    const res = await this.save({
      engine: 'sqlite@dbgate-plugin-sqlite',
      databaseFile,
      singleDatabase: true,
      defaultDatabase: `${file}.sqlite`,
    });
    return res;
  },
};

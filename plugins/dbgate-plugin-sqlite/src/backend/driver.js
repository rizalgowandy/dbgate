const _ = require('lodash');
const stream = require('stream');
const driverBase = require('../frontend/driver');
const Analyser = require('./Analyser');
const { splitQuery, sqliteSplitterOptions } = require('dbgate-query-splitter');
const { getLogger, createBulkInsertStreamBase, extractErrorLogData } = global.DBGATE_PACKAGES['dbgate-tools'];

const logger = getLogger('sqliteDriver');

let betterSqliteValue;
function getBetterSqlite() {
  if (!betterSqliteValue) {
    betterSqliteValue = require('better-sqlite3');
  }
  return betterSqliteValue;
}

async function waitForDrain(stream) {
  return new Promise((resolve) => {
    stream.once('drain', () => {
      // console.log('CONTINUE DRAIN');
      resolve();
    });
  });
}

function runStreamItem(dbhan, sql, options, rowCounter) {
  const stmt = dbhan.client.prepare(sql);
  if (stmt.reader) {
    const columns = stmt.columns();
    // const rows = stmt.all();

    options.recordset(
      columns.map((col) => ({
        columnName: col.name,
        dataType: col.type,
      }))
    );

    for (const row of stmt.iterate()) {
      options.row(row);
    }
  } else {
    const info = stmt.run();
    rowCounter.count += info.changes;
    if (!rowCounter.date) rowCounter.date = new Date().getTime();
    if (new Date().getTime() > rowCounter.date > 1000) {
      options.info({
        message: `${rowCounter.count} rows affected`,
        time: new Date(),
        severity: 'info',
      });
      rowCounter.count = 0;
      rowCounter.date = null;
    }
  }
}

/** @type {import('dbgate-types').EngineDriver} */
const driver = {
  ...driverBase,
  analyserClass: Analyser,
  async connect({ databaseFile, isReadOnly }) {
    const Database = getBetterSqlite();
    const client = new Database(databaseFile, { readonly: !!isReadOnly });
    return {
      client,
    };
  },
  async close(dbhan) {
    // sqlite close is sync, returns this
    dbhan.client.close();
  },
  // @ts-ignore
  async query(dbhan, sql) {
    const stmt = dbhan.client.prepare(sql);
    // stmt.raw();
    if (stmt.reader) {
      const columns = stmt.columns();
      const rows = stmt.all();
      return {
        rows,
        columns: columns.map((col) => ({
          columnName: col.name,
          dataType: col.type,
        })),
      };
    } else {
      stmt.run();
      return {
        rows: [],
        columns: [],
      };
    }
  },
  async stream(dbhan, sql, options) {
    const sqlSplitted = splitQuery(sql, sqliteSplitterOptions);

    const rowCounter = { count: 0, date: null };

    const inTransaction = dbhan.client.transaction(() => {
      for (const sqlItem of sqlSplitted) {
        runStreamItem(dbhan, sqlItem, options, rowCounter);
      }

      if (rowCounter.date) {
        options.info({
          message: `${rowCounter.count} rows affected`,
          time: new Date(),
          severity: 'info',
        });
      }
    });

    try {
      inTransaction();
    } catch (error) {
      logger.error(extractErrorLogData(error), 'Stream error');
      const { message, procName } = error;
      options.info({
        message,
        line: 0,
        procedure: procName,
        time: new Date(),
        severity: 'error',
      });
    }

    options.done();
    // return stream;
  },
  async script(dbhan, sql) {
    const inTransaction = dbhan.client.transaction(() => {
      for (const sqlItem of splitQuery(sql, this.getQuerySplitterOptions('script'))) {
        const stmt = dbhan.client.prepare(sqlItem);
        stmt.run();
      }
    });
    inTransaction();
  },

  async readQueryTask(stmt, pass) {
    // let sent = 0;
    for (const row of stmt.iterate()) {
      // sent++;
      if (!pass.write(row)) {
        // console.log('WAIT DRAIN', sent);
        await waitForDrain(pass);
      }
    }
    pass.end();
  },
  async readQuery(dbhan, sql, structure) {
    const pass = new stream.PassThrough({
      objectMode: true,
      highWaterMark: 100,
    });

    const stmt = dbhan.client.prepare(sql);
    const columns = stmt.columns();

    pass.write({
      __isStreamHeader: true,
      ...(structure || {
        columns: columns.map((col) => ({
          columnName: col.name,
          dataType: col.type,
        })),
      }),
    });
    this.readQueryTask(stmt, pass);

    return pass;
  },
  async writeTable(dbhan, name, options) {
    return createBulkInsertStreamBase(this, stream, dbhan, name, options);
  },
  async getVersion(dbhan) {
    const { rows } = await this.query(dbhan, 'select sqlite_version() as version');
    const { version } = rows[0];

    return {
      version,
      versionText: `SQLite ${version}`,
    };
  },
};

driver.initialize = (dbgateEnv) => {};

module.exports = driver;

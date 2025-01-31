const engines = require('../engines');
const stream = require('stream');
const { testWrapper } = require('../tools');
const tableWriter = require('dbgate-api/src/shell/tableWriter');
const tableReader = require('dbgate-api/src/shell/tableReader');
const copyStream = require('dbgate-api/src/shell/copyStream');
const importDatabase = require('dbgate-api/src/shell/importDatabase');
const fakeObjectReader = require('dbgate-api/src/shell/fakeObjectReader');
const { runQueryOnDriver, runCommandOnDriver } = require('dbgate-tools');

function createImportStream() {
  const pass = new stream.PassThrough({
    objectMode: true,
  });
  pass.write({ columns: [{ columnName: 'id' }, { columnName: 'country' }], __isStreamHeader: true });
  pass.write({ id: 1, country: 'Czechia' });
  pass.write({ id: 2, country: 'Austria' });
  pass.write({ country: 'Germany', id: 3 });
  pass.write({ country: 'Romania', id: 4 });
  pass.write({ country: 'Great Britain', id: 5 });
  pass.write({ country: 'Bosna, Hecegovina', id: 6 });
  pass.end();

  return pass;
}

function createExportStream() {
  const writable = new stream.Writable({ objectMode: true });
  writable.resultArray = [];
  writable._write = (chunk, encoding, callback) => {
    writable.resultArray.push(chunk);
    callback();
  };
  return writable;
}

describe('DB Import/export', () => {
  test.each(engines.map(engine => [engine.label, engine]))(
    'Import one table - %s',
    testWrapper(async (conn, driver, engine) => {
      // const reader = await fakeObjectReader({ delay: 10 });
      // const reader = await fakeObjectReader();
      const reader = createImportStream();
      const writer = await tableWriter({
        systemConnection: conn,
        driver,
        pureName: 't1',
        createIfNotExists: true,
      });
      await copyStream(reader, writer);

      const res = await runQueryOnDriver(conn, driver, dmp => dmp.put(`select count(*) as ~cnt from ~t1`));
      expect(res.rows[0].cnt.toString()).toEqual('6');
    })
  );

  test.each(engines.map(engine => [engine.label, engine]))(
    'Import two tables - %s',
    testWrapper(async (conn, driver, engine) => {
      // const reader = await fakeObjectReader({ delay: 10 });
      // const reader = await fakeObjectReader();
      const reader1 = createImportStream();
      const writer1 = await tableWriter({
        systemConnection: conn,
        driver,
        pureName: 't1',
        createIfNotExists: true,
      });
      await copyStream(reader1, writer1);

      const reader2 = createImportStream();
      const writer2 = await tableWriter({
        systemConnection: conn,
        driver,
        pureName: 't2',
        createIfNotExists: true,
      });
      await copyStream(reader2, writer2);

      const res1 = await runQueryOnDriver(conn, driver, dmp => dmp.put(`select count(*) as ~cnt from ~t1`));
      expect(res1.rows[0].cnt.toString()).toEqual('6');

      const res2 = await runQueryOnDriver(conn, driver, dmp => dmp.put(`select count(*) as ~cnt from ~t2`));
      expect(res2.rows[0].cnt.toString()).toEqual('6');
    })
  );

  test.each(engines.filter(x => x.dumpFile).map(engine => [engine.label, engine]))(
    'Import SQL dump - %s',
    testWrapper(async (conn, driver, engine) => {
      // const reader = await fakeObjectReader({ delay: 10 });
      // const reader = await fakeObjectReader();
      await importDatabase({
        systemConnection: conn,
        driver,
        inputFile: engine.dumpFile,
      });

      const structure = await driver.analyseFull(conn);

      for (const check of engine.dumpChecks || []) {
        const res = await driver.query(conn, check.sql);
        expect(res.rows[0].res.toString()).toEqual(check.res);
      }

      // const res1 = await driver.query(conn, `select count(*) as cnt from t1`);
      // expect(res1.rows[0].cnt.toString()).toEqual('6');

      // const res2 = await driver.query(conn, `select count(*) as cnt from t2`);
      // expect(res2.rows[0].cnt.toString()).toEqual('6');
    })
  );

  test.each(engines.map(engine => [engine.label, engine]))(
    'Export one table - %s',
    testWrapper(async (conn, driver, engine) => {
      // const reader = await fakeObjectReader({ delay: 10 });
      // const reader = await fakeObjectReader();
      await runCommandOnDriver(conn, driver, 'create table ~t1 (~id int primary key, ~country varchar(100))');
      const data = [
        [1, 'Czechia'],
        [2, 'Austria'],
        [3, 'Germany'],
        [4, 'Romania'],
        [5, 'Great Britain'],
        [6, 'Bosna, Hecegovina'],
      ];
      for (const row of data) {
        await runCommandOnDriver(conn, driver, dmp =>
          dmp.put('insert into ~t1(~id, ~country) values (%v, %v)', ...row)
        );
      }
      const reader = await tableReader({
        systemConnection: conn,
        driver,
        pureName: 't1',
      });
      const writer = createExportStream();
      await copyStream(reader, writer);

      expect(writer.resultArray.filter(x => !x.__isStreamHeader).map(row => [row.id, row.country])).toEqual(data);
    })
  );
});

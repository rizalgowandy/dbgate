const { SqlDumper, arrayToHexString } = global.DBGATE_TOOLS;
const _isArray = require('lodash/isArray');

class Dumper extends SqlDumper {
  /** @param type {import('dbgate-types').TransformType} */
  transform(type, dumpExpr) {
    switch (type) {
      case 'GROUP:YEAR':
      case 'YEAR':
        this.put('^year(%c)', dumpExpr);
        break;
      case 'MONTH':
        this.put('^month(%c)', dumpExpr);
        break;
      case 'DAY':
        this.put('^day(%c)', dumpExpr);
        break;
      case 'GROUP:MONTH':
        this.put("^date_format(%c, '%s')", dumpExpr, '%Y-%m');
        break;
      case 'GROUP:DAY':
        this.put("^date_format(%c, '%s')", dumpExpr, '%Y-%m-%d');
        break;
      default:
        dumpExpr();
        break;
    }
  }

  renameTable(obj, newName) {
    this.putCmd('^rename ^table %f ^to %i', obj, newName);
  }

  changeColumn(oldcol, newcol, constraints) {
    this.put('^alter ^table %f ^change ^column %i %i ', oldcol, oldcol.columnName, newcol.columnName);
    this.columnDefinition(newcol);
    this.inlineConstraints(constraints);
    this.endCommand();
  }

  renameColumn(column, newcol) {
    this.changeColumn(
      column,
      {
        ...column,
        columnName: newcol,
      },
      []
    );
  }

  enableConstraints(table, enabled) {
    this.putCmd('^set FOREIGN_KEY_CHECKS = %s', enabled ? '1' : '0');
  }

  comment(value) {
    this.put('/* %s */', value);
  }

  beginTransaction() {
    this.putCmd('^start ^transaction');
  }

  selectTableIntoNewTable(sourceName, targetName) {
    this.putCmd('^create ^table %f (^select * ^from %f)', targetName, sourceName);
  }

  putValue(value) {
    if (value && value.type == 'Buffer' && _isArray(value.data)) {
      this.putRaw(`unhex('${arrayToHexString(value.data)}')`);
    } else {
      super.putValue(value);
    }
  }
}

module.exports = Dumper;

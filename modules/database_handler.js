/**
 * Find rows based on conditions. Leave args empty to retrieve all rows
 * @param {BetterSQLite3.Database} db Database
 * @param {string} table Table name
 * @param {any[][]} args Conditions in this format: [table_key, value]
 * @returns {any[]} Returns all rows passing all conditions (if none found, then an empty array is returned)
 */
function find(db, table, args = []) {
    const values = [];
    let statement = `SELECT * FROM ${table} WHERE`;
    if (args.length === 0) {
        statement += " true"; // Return all rows
    } else {
        for (let i=0; i<args.length; i++) {
            const key = args[i][0];
            const value = args[i][1];
            values.push(value);
            statement += ` ${key} = ?`;
            if (i < args.length-1) statement += " AND";
        }
    }
    
    const rows = db.prepare(statement).all(...values);
    return rows;
}

/**
 * Inserts new row(s) into table
 * @param {BetterSQLite3.Database} db Database
 * @param {string} table Table name
 * @param  {any[][]} args Arguments in this format: [table_key, value]
 */
function addRow(db, table, args = []) {
    const values = [];
    let statement = `INSERT INTO ${table} (`;
    for (let i=0; i<args.length; i++) {
        statement += args[i][0];
        values.push(args[i][1]);
        if (i < args.length-1) statement += ",";
    }
    statement += ") VALUES (";
    for (let i=0; i<args.length; i++) {
        statement += "?";
        if (i < args.length-1) statement += ",";
    }
    statement += ")";
    db.prepare(statement).run(...values);
}

/**
 * Update column(s) within a row
 * @param {BetterSQLite3.Database} db Database
 * @param {string} table Table name
 * @param {any[][]} args Arguments in this format: [table_key, value]
 * @param {any[][]} conditions Conditions in this format: [condition_column, condition_value]
 */
function update(db, table, args = [], conditions = []) {
    const values = [];
    let statement = `UPDATE ${table} SET`;
    for (let i=0; i<args.length; i++) {
        statement += ` ${args[i][0]} = ?`;
        values.push(args[i][1])
        if (i < args.length-1) statement += ",";
    }

    statement += ` WHERE`;
    if (conditions.length === 0) {
        statement += " true"; // Perform update without condition checks
    } else {
        for (let i=0; i<conditions.length; i++) {
            statement += ` ${conditions[i][0]} = ?`;
            values.push(conditions[i][1]);
            if (i < conditions.length-1) statement += ` AND`;
        }
    }
    db.prepare(statement).run(...values);
}

/**
 * Delete row(s) from a table based on conditions
 * @param {BetterSQLite3.Database} db Database
 * @param {string} table Table name
 * @param {any[][]} conditions WARNING: EMITTING THIS WILL DELETE ALL ROWS - Conditions in this format: [condition_column, condition_value]
 */
function deleteRow(db, table, conditions = []) {
    const values = [];
    let statement = `DELETE FROM ${table} WHERE`;
    if (conditions.length === 0) {
        statement += " true";
    } else {
        for (let i=0; i<conditions.length; i++) {
            statement += `${conditions[i][0]} = ?`;
            values.push(conditions[i][1]);
            if (i < conditions.length-1) statement += " AND";
        }
    }
    db.prepare(statement).run(...values);
}

module.exports = {
    find,
    addRow,
    update,
    deleteRow
};
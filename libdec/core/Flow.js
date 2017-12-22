/* 
 * Copyright (C) 2017 deroad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */


module.exports = (function() {
    var Branch = require('./Branch');
    var Scope = require('./Scope');
    var cfg = require('../config');
    Utils = require('./Utils');

    var _label_counter = 0;

    var AddrBounds = function(low, hi) {
        this.low = low;
        this.hi = hi;

        this.isInside = function(addr) {
            return addr.gte(this.low) && addr.lte(this.hi);
        }
    };

    var _compare_loc = function(a, b) {
        if (a.eq(b.loc)) {
            return 0;
        }
        return a.lt(b.loc) ? 1 : -1;
    };
    /* [long] jumps */
    var _detect_jumps = function(instructions, index, context) {
        var instr = instructions[index];
        if (context.limits.isInside(instr.jump)) {
            return false;
        }
        if (!instr.pseudo) {
            instr.pseudo = 'goto 0x' + instr.jump.toString(16) + ';'
        }
        return true;
    };

    var _detect_if_break = function(instructions, bounds, scope) {
        for (var i = instructions.length - 1; i > 0; i--) {
            instr = instructions[i];
            //if (instr.) {}
            if (instr.scope.level > scope.level) {
                instr.scope = scope;
            }
        }
        return true;
    };

    var _set_label = function(instructions, index) {
        var label = _label_counter++;
        var instr = instructions[index];
        instr.pseudo = 'goto label_' + label + ';';
        for (var i = index; i < instructions.length; i++) {
            var tmpinstr = instructions[i];
            if (tmpinstr.loc.eq(instr.jump)) {
                tmpinstr.label = label;
                break;
            }
        }
    };

    var _detect_while = function(instructions, index, context) {
        var instr = instructions[index];
        /* while(cond) { block } */
        if (instr.jump.lte(instr.loc)) {
            /* infinite loop */
            var scope = new Scope();
            var bounds = new AddrBounds(instr.jump, instr.loc);
            var cond = instr.cond ? Branch.generate(instr.cond.a, instr.cond.b, instr.cond.type, Branch.FLOW_DEFAULT) : Branch.true();
            var tmpinstr = Utils.search(instr.jump, instructions, _compare_loc);
            var start = instructions.indexOf(tmpinstr);
            scope.level = instructions[start].scope.level + 1;
            scope.header = 'do {';
            for (var i = start; i <= index; i++) {
                tmpinstr = instructions[i];
                if (tmpinstr.scope.level == scope.level) {
                    tmpinstr.scope.level++;
                } else if (tmpinstr.scope.level < scope.level) {
                    tmpinstr.scope = scope;
                }
                if (tmpinstr.jump && tmpinstr.jump.gt(tmpinstr.loc) && !bounds.isInside(tmpinstr.jump)) {
                    if (!tmpinstr.pseudo) {
                        _set_label(instructions, i);
                        tmpinstr = Utils.search(tmpinstr.jump, instructions, _compare_loc);
                        _detect_if(instructions.slice(i, index), 0, context, true);
                    }
                }
            }
            scope.trailer = '} while (' + cond + ');';
            return true;
        }
        return false;
    };

    var _detect_if = function(instructions, index, context, remove_jumps) {
        var instr = instructions[index];
        if (instr.jump.lte(instr.loc) || !instr.cond) {
            return false;
        }
        var scope = new Scope();
        var level = instr.scope.level;
        scope.level = level + 1;
        var bounds = new AddrBounds(instr.loc, instr.jump);
        /* if(cond) { block } */
        var cond = instr.cond ? Branch.generate(instr.cond.a, instr.cond.b, instr.cond.type, Branch.FLOW_DEFAULT) : Branch.true();
        var end = instr.jump;
        var fail = instr.fail;
        scope.header = 'if (' + cond + ') {';
        scope.trailer = '}';
        if (remove_jumps) {
            instr.jump = null;
            instr.fail = null;
        }
        for (var i = index; i < instructions.length; i++) {
            instr = instructions[i];
            if (end.lte(instr.loc) || (!instr.fail && instr.fail != fail)) {
                break;
            }
            if (instr.scope.level == scope.level) {
                instr.scope.level++;
            } else if (instr.scope.level >= level && instr.scope.level < scope.level) {
                instr.scope = scope;
            }
            if (instr.jump && !instr.fail && context.limits.isInside(instr.jump) && !bounds.isInside(instr.jump)) {
                end = instr.jump;
                scope.trailer = '}';
                scope = new Scope();
                scope.level = instr.scope.level;
                scope.header = 'else {';
                scope.trailer = '}';
            }
        }
        return true;
    };

    return function(instructions) {
        var context = {
            limits: new AddrBounds(instructions[0].loc, instructions[instructions.length - 1].loc)
        };
        for (var i = 0; i < instructions.length; i++) {
            if (!instructions[i].jump) {
                continue;
            }
            if (!_detect_jumps(instructions, i, context)) {
                _detect_while(instructions, i, context);
            }
        }
        for (var i = 0; i < instructions.length; i++) {
            if (!instructions[i].jump) {
                continue;
            }
            if (!_detect_jumps(instructions, i, context)) {
                _detect_if(instructions, i, context);
            }
        }
    };
})();
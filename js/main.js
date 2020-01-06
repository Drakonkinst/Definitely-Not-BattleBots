// TODO zoom on mouse

const CANVAS_MARGIN = 0.05;
const CANVAS_DIMENSION_MULTIPLIER = 1 - CANVAS_MARGIN * 2;
const RECORD_INTERVAL = 20;
const COLLISION_DISTANCE = 10;
const SPAWN_MARGIN = 40;

const TWO_PI = Math.PI * 2.0;

var canvas;
var worldTick = 0;
var maxFPS = 0;
var dummySteering;
var zoom = 1.0;
var isGameOver = false;

/* CONFIG */
var Config = (function() {
    var userConfig = {};

    // import config from another file if possible
    if(typeof getConfig === "function") {
        userConfig = getConfig();
        debug("Config loaded!");
    }
    var result = {};

    function setDefaultConfig(options, initial) {
        for(var k in options) {
            if(options.hasOwnProperty(k)) {
                if(userConfig.hasOwnProperty(k)) {
                    result[k] = userConfig[k];
                } else {
                    result[k] = options[k];
    }
    }
    }
    }

    setDefaultConfig({
        "isStopped": false,
        "shouldOptimizeTrails": false,
        "shouldChaseMouse": false,
        "shouldAnnounceKills": false,
        "shouldDrawPaths": false,
        "shouldDrawUnits": true,
        "shouldDrawGraves": false,
        "shouldHighlightAvoiding": false,
        "drawDeadPaths": false,
        "showFPS": false,
        "showMouseInfo": true,
        "showTeamInfo": true,
        "howMany": 300,
        "shouldFixSpawn": true,
        "electricFence": true,
        "infectionMode": false,
        "populationCombatBalance": false
    });

    return result;
})();

    /**
     * Returns the magnitude of the vector.
     * 
     * @returns {number} The magnitude of the vector.
     */
    magnitude() {
        return Math.sqrt(this.magnitudeSquared());
    }

    /**
     * Returns the squared magnitude of the vector.
     * 
     * @returns {number} The squared magnitude of the vector.
     */
    magnitudeSquared() {
        return this.dot(this);
    }

    /**
     * Returns the squared distance between the current vector and another
     * vector.
     * 
     * @param {Vector} vector The vector to calculate the squared distance
     *                        between.
     * @returns {number} The squared distance between the current vector
     *                   and another vector.
     */
    distanceSquared(vector) {
        var deltaX = this.x - vector.x;
        var deltaY = this.y - vector.y;
        return deltaX * deltaX + deltaY * deltaY;
    }

    /**
     * Returns the distance between the current vector and another vector.
     * 
     * @param {Vector} vector The vector to calculate the distance between.
     * @returns {number} The distance between the current vector and another
     *                   vector.
     */
    distance(vector) {
        return Math.sqrt(this.distanceSquared(vector));
    }

    /**
     * Prints the vector in the form (x, y).
     * 
     * @param {boolean} shouldRound True if vector entries should be rounded to
     *                              the nearest integer.
     * @returns {String} "(x, y)"
     */
    toString(shouldRound) {
        if(shouldRound) {
            return "(" + Math.round(this.x) + ", " + Math.round(this.y) + ")";
        }
        return "(" + this.x + ", " + this.y + ")";
    }
    
}

/* Unit */
// TODO finite state machine
class Unit {
    constructor(x, y, team) {
        this.id = generateID();
        this.team = team || Team.BLUE;
        this.pos = new Vector(x, y);
        this.velocity = new Vector(Math.random() * 2 - 1, Math.random() * 2 - 1);
        this.maxVelocity = this.team.speed;
        this.steering = new SteeringManager(this);
        pathMap[this.id] = [ this.pos.copy() ];

        this.isDead = false;
        this.isResting = false;
        this.numKills = 0;
    }

    static get(id) {
        return Unit.unitList[id - 2];
    }
    
    update() {
        if(this.isDead) {
            return;
        }
        var isBusy = this.steering.checkBounds();

        if(!isBusy) {

            /*
            // Default AI
            if(Config.shouldChaseMouse) {
                var mousePos = getMousePos();
                if(this.steering.isValid(mousePos)) {
                    this.steering.seek(mousePos);
                    isBusy = true;
                }
            }
            if(!isBusy) {
                this.steering.wander();
            }*/

            this.team.update(this);
        }
    
        this.steering.update();
        
        if(!this.steering.isValid(this.pos)) {
            debug("CRITICAL FAILURE AT " + this.pos.toString());
            if(Config.electricFence) {
                this.isDead = true;
                this.team.unitsRemaining--;
            }
        }
        
        if(worldTick % RECORD_INTERVAL == 0) {
            pathMap[this.id].push(this.pos.copy());
        }

        this.collisionCheck();
    }

    collisionCheck() {
        // collision check - death on collision
        for(var i in Unit.unitList) {
            var other = Unit.unitList[i];
            if(other != this && other.team != this.team && !other.isDead && this.pos.distance(other.pos) < COLLISION_DISTANCE) {
                // there's a collision!
                var population = Team.GREEN.unitsRemaining
                            + Team.RED.unitsRemaining
                            + Team.BLUE.unitsRemaining
                            + Team.YELLOW.unitsRemaining;

                var win;
                if(Config.populationCombatBalance) {
                    win = chance(1 - (this.team.unitsRemaining / population)) ? this : other;
                } else {
                    win = chance(0.5) ? this : other;
                }
                var lose = (win == this) ? other : this;
                if(Config.shouldAnnounceKills) {
                    debug(win.id + "(" + win.team.color.toUpperCase() + ") killed " + lose.id + "(" + lose.team.color.toUpperCase() + ")");
                }
                
                lose.team.unitsRemaining--;
                if(lose.team.unitsRemaining <= 0) {
                    debug(lose.team.color.toUpperCase() + " has been eliminated!");
                }

                if(win.team.canCorrupt) {
                    win.team.unitsRemaining++;
                    lose.team = win.team;
                    lose.maxVelocity = lose.team.speed;
                } else {
                    lose.isDead = true;
                }

                // tracks the unit with the highest killstreak
                win.numKills++;
                if(win.numKills > Unit.maxKills) {
                    Unit.maxKills = win.numKills;
                    Unit.highestKiller = win.id;
                }
                return;
            }
        }
    }

    /*
    nearestEnemy(maxDistance) {

    }*/
}

Unit.unitList = []; // TODO later move to World.unitList
Unit.teamMap = {};
Unit.highestKiller = -1;
Unit.maxKills = -1;

/* SteeringManager */
class SteeringManager {
    constructor(unit) {
        this.host = unit;
        this.wanderAngle = Math.random() * TWO_PI;
        this.isAvoiding = false;
        this.reset();   // adds steering variable
    }

    static truncate(vector, max) {
        if(vector.magnitude() > max) {
            vector.scaleToMagnitude(max);
        }
    }

    update() {
        SteeringManager.truncate(this.steering, SteeringManager.MAX_FORCE);
        this.host.velocity.add(this.steering);
        SteeringManager.truncate(this.host.velocity, this.host.maxVelocity);

        this.host.pos.add(this.host.velocity);
        if(!this.isValid(this.host.pos)) {
            debug("CRITICAL FAILURE AT " + this.host.pos.toString());
            if(electricFence) {
                this.host.isDead = true;
            }
        }
        this.reset();
    }
    
    reset() {
        this.steering = new Vector();
    }

    seek(targetPos, slowingRadius) {
        slowingRadius = slowingRadius || 20;
        var distance = this.host.pos.distance(targetPos);

        var seekForce = targetPos.copy().subtract(this.host.pos);

        if(distance < slowingRadius) {
            seekForce.scaleToMagnitude(this.host.maxVelocity * (distance / slowingRadius));
        } else {
            seekForce.scaleToMagnitude(this.host.maxVelocity);
        }

        this.steering.add(seekForce.subtract(this.host.velocity));
    }

    flee(targetPos) {
        var fleeForce = this.host.pos.copy()
            .subtract(targetPos)
            .scaleToMagnitude(this.host.maxVelocity)
            .subtract(this.host.velocity);
        this.steering.add(fleeForce);
    }

    // return true if hits bounds, false otherwise
    checkBounds() {
        /*
        if(this.host.velocity == new Vector(0, 0)) {
            return false;
        }*/
        const HALF_AHEAD = SteeringManager.AHEAD_DISTANCE / 2.0;

        var ahead = this.host.velocity.copy().scaleToMagnitude(SteeringManager.AHEAD_DISTANCE);
        var ahead2 = ahead.copy().divide(2.0);

        var facing = Math.atan2(ahead.y, ahead.x);
        var aheadLeft = new Vector(Math.cos(facing + SteeringManager.AHEAD_ANGLE), Math.sin(facing + SteeringManager.AHEAD_ANGLE)).scale(HALF_AHEAD);
        var aheadRight = new Vector(Math.cos(facing + SteeringManager.AHEAD_ANGLE), Math.sin(facing + SteeringManager.AHEAD_ANGLE)).scale(HALF_AHEAD);

        ahead.add(this.host.pos);
        ahead2.add(this.host.pos);
        aheadLeft.add(this.host.pos);
        aheadRight.add(this.host.pos);

        var center = new Vector(width / 2, height / 2);

        if(this.isValid(ahead)
        && this.isValid(ahead2)
        && this.isValid(aheadLeft)
        && this.isValid(aheadRight)) {
            if(this.isAvoiding) {
                this.isAvoiding = false;

                // reset wander angle so NPC does not try to run into walls again
                this.wanderAngle = Math.atan2(center.y - this.host.pos.y, center.x - this.host.pos.x);
            }
            return false;
        }

        this.isAvoiding = true;
        this.seek(center, 0);
        return true;
    }

    wander() {
        var circleCenter = this.host.velocity.copy().scaleToMagnitude(SteeringManager.WANDER_CIRCLE_DISTANCE);

        this.wanderAngle += Math.random() * (SteeringManager.MAX_ANGLE_CHANGE * 2) - SteeringManager.MAX_ANGLE_CHANGE;
        this.wanderAngle = this.wanderAngle - TWO_PI * Math.floor((this.wanderAngle + Math.PI) / TWO_PI);

        var displacement = new Vector(Math.cos(this.wanderAngle), Math.sin(this.wanderAngle)).scale(SteeringManager.WANDER_CIRCLE_RADIUS);
        
        // add wander force
        var wanderForce = circleCenter.add(displacement);
        this.steering.add(wanderForce);
    }

    isValid(vector) {
        return vector.x > 0 && vector.x < width
            && vector.y > 0 && vector.y < height;
    }
}

SteeringManager.MAX_FORCE = 0.1;
SteeringManager.WANDER_CIRCLE_DISTANCE = 3.0;
SteeringManager.WANDER_CIRCLE_RADIUS = 3.0;
SteeringManager.MAX_ANGLE_CHANGE = toRadians(15);
SteeringManager.AHEAD_DISTANCE = 100.0;
SteeringManager.AHEAD_ANGLE = toRadians(30.0);

function gangAI(team) {
    const MIN_FOLLOW_DISTANCE = 100;
    team.leader = null;

    function pickNewLeader() {
        var choices = [];
        for(var i in Unit.unitList) {
            var unit = Unit.unitList[i];
            if(!unit.isDead && unit.team == team) {
                choices.push(unit);
            }
        }
        team.leader = choose(choices);
        team.leader.maxVelocity -= 0.5;
        //team.leader.maxVelocity = 5.0; // SANIC HOURS
    }

    return function(unit) {
        // choose new leader if one does not exist, leader is dead, or leader has changed sides
        if(team.leader == null || team.leader.isDead || team.leader.team != unit.team) {
            debug(team.color.toUpperCase() + " chose a new leader!");
            pickNewLeader();
        }

        if(unit.id == team.leader.id
        || unit.pos.distance(team.leader.pos) < MIN_FOLLOW_DISTANCE) {
            unit.steering.wander();
        } else {
            unit.steering.seek(team.leader.pos, 0);
        }

    }
}
const Team = (function() {
    // calculate canvas dimensions by hand since it technically doesn't exist yet
    const rightEdge = window.innerWidth * CANVAS_DIMENSION_MULTIPLIER - SPAWN_MARGIN;
    const bottomEdge = window.innerHeight * CANVAS_DIMENSION_MULTIPLIER - SPAWN_MARGIN;
    return {
        RED: {
            color: "red",
            speed: 1.5,
            canCorrupt: false,
            spawn: new Vector(SPAWN_MARGIN, SPAWN_MARGIN),
            update: function(unit) {
                const HUNTING_DISTANCE = 150;
                const TOO_MANY_ENEMIES = 5;
                const ISOLATED_GROUP = 5;
                var numEnemiesNearby = 0;
                var minDistance = 150;
                var closestEnemy = null;

                for(var i in Unit.unitList) {
                    var enemy = Unit.unitList[i];
                    if(enemy.team == unit.team || enemy.isDead) {
                        continue;
                    }
                    var distance = unit.pos.distance(enemy.pos);
                    if(distance < HUNTING_DISTANCE) {
                        numEnemiesNearby++;
                        if(distance < minDistance) {
                            minDistance = distance;
                            closestEnemy = enemy;
                        }
                    }
                    
                    if(numEnemiesNearby > TOO_MANY_ENEMIES) {
                        //unit.steering.wander();
                        unit.steering.flee(closestEnemy.pos);
                        return;
                    }
                }
                
                if(numEnemiesNearby < ISOLATED_GROUP && closestEnemy != null) {
                    unit.steering.seek(closestEnemy.pos);
                } else {
                    unit.steering.wander();
                }
            }
        },
        BLUE: {
            color: "blue",
            speed: 2.0,
            canCorrupt: false,
            spawn: new Vector(rightEdge, SPAWN_MARGIN),
            update: function(unit) {
                var minDistance = 200;
                var closestEnemy = null;
                for(var i in Unit.unitList) {
                    var enemy = Unit.unitList[i];
                    if(enemy.team != Team.RED || enemy.isDead) {
                        continue;
                    }
                    var distance = unit.pos.distance(enemy.pos);
                    if(distance < minDistance) {
                        minDistance = distance;
                        closestEnemy = enemy;
                    }
                }
                if(closestEnemy != null) {
                    unit.steering.flee(closestEnemy.pos);
                } else {
                    unit.steering.wander();
                }
            }
        },
        GREEN: {
            color: "lime",
            speed: 4.0,
            canCorrupt: false,
            spawn: new Vector(SPAWN_MARGIN, bottomEdge),
            update: function(unit) {}
        },
        YELLOW: {
            color: "yellow",
            speed: 4.0,
            canCorrupt: false,
            spawn: new Vector(rightEdge, bottomEdge),
            update: (function() {
                const REST_LENGTH = 2000;
                const MOVE_LENGTH = 3000;
                var isResting = false;

                var toggle = function() {
                    //debug(isResting);
                    var timeUntilSwitch;
                    if(isResting) {
                        timeUntilSwitch = MOVE_LENGTH;
                    } else {
                        timeUntilSwitch = REST_LENGTH;
                    }
                    isResting = !isResting;
                    setTimeout(toggle, timeUntilSwitch);
                }
                toggle();

                return function(unit) {
                    
                }
            })()
        }
    }
})();
Team.GREEN.update = gangAI(Team.GREEN);
//Team.YELLOW.update = gangAI(Team.YELLOW);
//Team.RED.update = gangAI(Team.RED);
//Team.BLUE.update = gangAI(Team.BLUE);

/* Utils */
function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

function toDegrees(radians) {
    return radians * (180 / Math.PI);
}

function getCanvasWidth() {
    return windowWidth * CANVAS_DIMENSION_MULTIPLIER;
}

function getCanvasHeight() {
    return windowHeight * CANVAS_DIMENSION_MULTIPLIER;
}

function resetCanvasSize() {
    resizeCanvas(getCanvasWidth(), getCanvasHeight());
}

var generateID = (function() {
    var currentId = 0;

    return function() {
        return ++currentId;
    }
})();

function getMousePos() {
    return new Vector(mouseX / zoom, mouseY / zoom);
}

function chance(chance) {
    return Math.random() < chance;
}

function choose(array) {
    return array[Math.floor(Math.random() * array.length)];
}


/* Draw */
function draw() {
    var start = Date.now();
    update();

    clear();
    scale(zoom);
    background(200);

    fill(180);
    stroke(0);
    strokeWeight(5.0);
    rect(0, 0, width, height);

    if(Config.shouldDrawPaths) {
        drawPaths();
    }
    
    if(Config.shouldDrawUnits) {
        drawUnits();
    }
    
    // Window Info
    scale(1 / zoom);
    var elapsed = Date.now() - start;
    if(elapsed >= 10 && Config.shouldOptimizeTrails) {
        debug("[!] High lag detected, employing optimizations");
        optimizePaths();
    }
    if(elapsed > maxFPS) {
        maxFPS = elapsed;
    }

    stroke(0);
    fill(0);

    if(Config.showFPS) {
        text(elapsed + "ms (" + Math.round(1000 / elapsed) + " fps)", 25, 30);
        text("Max: " + maxFPS + "ms", 25, 45);
    }

    if(Config.showTeamInfo) {
        text("Red: " + Team.RED.unitsRemaining, width - 75, height - 75);
        text("Blue: " + Team.BLUE.unitsRemaining, width - 75, height - 60);
        text("Green: " + Team.GREEN.unitsRemaining, width - 75, height - 45);
        text("Yellow: " + Team.YELLOW.unitsRemaining, width - 75, height - 30);
    }

    if(Config.showMouseInfo) {
        var mousePos = getMousePos();
        if(!dummySteering.isValid(mousePos)) {
            fill("red");
        }
        text(mousePos.toString(true), 25, height - 30);

        var zoomText = (Math.round(10 * zoom) / 10);
        if(Number.isInteger(zoomText)) {
            zoomText = zoomText + ".0";
        }
        text("Zoom: " + zoomText, 25, height - 45);
    }
}

function drawUnits() {
    strokeWeight(0.5);
    stroke(0);
    for(var k in Unit.unitList) {
        var unit = Unit.unitList[k];
        drawUnit(unit);
    }
}

var drawUnit = (function() {
    const PRIMARY_LENGTH = 30;
    const SECONDARY_LENGTH = PRIMARY_LENGTH / 2;
    const SECONDARY_ANGLE = toRadians(120);
    const UNIT_GRAVE_COLOR = 50;
    const UNIT_GRAVE_RADIUS = 30;
    const UNIT_AVOIDING_COLOR = 0;

    return function(unit) {

        var pos = unit.pos;

        if(unit.isDead) {
            if(Config.shouldDrawGraves) {
                fill(UNIT_GRAVE_COLOR);
                ellipse(pos.x, pos.y, UNIT_GRAVE_RADIUS, UNIT_GRAVE_RADIUS);
            }
            return;
        /*
        } else if(unit.steering.isAvoiding) {
            fill(UNIT_AVOID_COLOR);
        }
        */
        } else {
            if(unit.steering.isAvoiding && Config.shouldHighlightAvoiding) {
                fill(UNIT_AVOIDING_COLOR);
            } else {
                fill(unit.team.color);
            }
        }

        // get vertices of isoceles triangle
        var theta1 = Math.atan2(unit.velocity.y, unit.velocity.x);
        var theta2 = theta1 + SECONDARY_ANGLE;
        var theta3 = theta1 - SECONDARY_ANGLE;

        // draw object in p5
        beginShape();
        vertex(pos.x, pos.y);
        vertex(pos.x + (SECONDARY_LENGTH * Math.cos(theta2)), pos.y + (SECONDARY_LENGTH * Math.sin(theta2)));
        vertex(pos.x + (PRIMARY_LENGTH * Math.cos(theta1)), pos.y + (PRIMARY_LENGTH * Math.sin(theta1)));
        vertex(pos.x + (SECONDARY_LENGTH * Math.cos(theta3)), pos.y + (SECONDARY_LENGTH * Math.sin(theta3)));
        endShape(CLOSE);

        if(unit.team.leader && unit.team.leader.id == unit.id) {
            var flagX = pos.x + (PRIMARY_LENGTH / 4 * Math.cos(theta1));
            var flagY = pos.y + (PRIMARY_LENGTH / 4 * Math.sin(theta1));

            drawFlag(flagX, flagY, "white");
        }
        strokeWeight(0.5);
    }
})();

function drawFlag(x, y, color) {
    stroke(0);
    strokeWeight(1.0);
    fill(color);
    line(x, y, x, y - 30);
    triangle(x, y - 30, x, y - 20, x + 15, y - 25);
}

var pathMap = {};
function drawPaths() {
    noFill();
    strokeWeight(2.0);
    var numVertices = 0;
    for(var k in Unit.unitList) {
        var unit = Unit.unitList[k];
        if(!Config.drawDeadPaths && unit.isDead) {
            continue;
        }
        var path = pathMap[unit.id];
        stroke(unit.team.color);
        beginShape();
        for(var i = 0; i < path.length; i++) {
            vertex(path[i].x, path[i].y);
            ++numVertices;
        }
        vertex(unit.pos.x, unit.pos.y);
        ++numVertices;
        endShape();
    }
}

function optimizePaths() {
    var numSnapped = 0;
    for(var k in pathMap) {
        if(pathMap.hasOwnProperty(k)) {
            var path = pathMap[k];
            for(var i = 1; i < path.length; i++) {
                path.splice(i, 1);
                numSnapped++;
            }
        }
    }
    debug(numSnapped + " vertices snapped");
}

function clearPaths() {
    for(var k in pathMap) {
        pathMap[k] = [];
    }
}
function clearDead() {
    var numDead = 0;
    for(var i = Unit.unitList.length - 1; i >= 0; i--) {
        if(Unit.unitList[i].isDead) {
            Unit.unitList.splice(i, 1);
            numDead++;
        }
    }
    debug(numDead + " graves cleared");
}

/* General */
function update() {
    if(Config.isStopped) {
        return;
    }

    
    worldTick++;
    for(var k in Unit.unitList) {
        Unit.unitList[k].update();
    }
    checkForWin();
}

function checkForWin() {
    var teamsRemaining = [];
    for(var k in Unit.teamMap) {
        for(var i in Unit.teamMap[k]) {
            if(!Unit.teamMap[k][i].isDead) {
                teamsRemaining.push(k);
                break;
            }
        }
    }
    if(teamsRemaining.length == 1) {
        debug("Game over, " + teamsRemaining[0] + " team wins!");
        isGameOver = true;
        Config.isStopped = true;
    }
    // do not immediately crash
    if(teamsRemaining.length == 0 && worldTick > 10) {
        debug("Something went wrong! Everyone is dead");
        Config.isStopped = true;
    }
}


function addUnit(x, y, team) {
    if(Config.shouldFixSpawn) {
        x = team.spawn.x;
        y = team.spawn.y;
    }
    var unit = new Unit(x, y, team);
    Unit.unitList.push(unit);
    Unit.teamMap[team.color].push(unit);
    team.unitsRemaining++;
}

function setup() {
    // register teams
    const TEAMS = [ Team.BLUE, Team.RED, Team.GREEN, Team.YELLOW ];
    for(var i in TEAMS) {
        var team = TEAMS[i];
        Unit.teamMap[team.color] = [];
        team.unitsRemaining = 0;
        if(Config.infectionMode) {
            team.canCorrupt = true;
        }
    }

    canvas = createCanvas(0, 0);
    resetCanvasSize();

    // spawn units
    for(var k in Team) {
        for(var i = 0; i < Config.howMany / 4; i++) {
            var x = Math.random() * (width - SPAWN_MARGIN) + SPAWN_MARGIN / 2;
            var y = Math.random() * (height - SPAWN_MARGIN) + SPAWN_MARGIN / 2;
            var team = Team[k];
            addUnit(x, y, team);
        }
    }
}

function windowResized() {
    //resetCanvasSize();
}

/* Mouse Events */
function mouseClicked() {
    // temporary functionality
    //debug(mouseButton + " (" + event.button + ")");
    if(isGameOver) {
        return;
    }
    Config.isStopped = !Config.isStopped;
}

function mouseWheel() {
    if(event.delta > 0) {
        zoom -= 0.1;
    } else {
        zoom += 0.1;
    }
}

function mouseDragged() {

}

(function() {
    debug("Loaded!");
    dummySteering = new SteeringManager(new Unit());
})();
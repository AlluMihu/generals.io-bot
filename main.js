var gameid = '74eu';

var io = require('/usr/local/lib/node_modules/socket.io/node_modules/socket.io-client');

var socket = io('http://botws.generals.io');

socket.on('disconnect', function() {
    console.error('Disconnected from server.');
    process.exit(1);
});

socket.on('connect', function() {
    console.log('Connected to server.');

    /* Don't lose this user_id or let other people see it!
     * Anyone with your user_id can play on your bot's account and pretend to be your bot.
     * If you plan on open sourcing your bot's code (which we strongly support), we recommend
     * replacing this line with something that instead supplies the user_id via an environment variable, e.g.
     * var user_id = process.env.BOT_USER_ID;
    */
    var user_id = 'MihuBot';
    var username = '[Bot]Mihu';

    // Set the username for the bot.
    // This should only ever be done once. See the API reference for more details.
    socket.emit('set_username', user_id, username);

    // Join a custom game and force start immediately.
    // Custom games are a great way to test your bot while you develop it because you can play against your bot!
    
    var custom_game_id = gameid;
    socket.emit('join_private', custom_game_id, user_id);
    socket.emit('set_force_start', custom_game_id, true);
    console.log('Joined custom game at http://bot.generals.io/games/' + encodeURIComponent(custom_game_id));
    

    /*socket.emit('join_1v1',user_id);  */
});

// Terrain Constants.
// Any tile with a nonnegative value is owned by the player corresponding to its value.
// For example, a tile with value 1 is owned by the player with playerIndex = 1.
var TILE_EMPTY = -1;
var TILE_MOUNTAIN = -2;
var TILE_FOG = -3;
var TILE_FOG_OBSTACLE = -4; // Cities and Mountains show up as Obstacles in the fog of war.

// Game data.
var playerIndex;
var generals; // The indicies of generals we have vision of.
var cities = []; // The indicies of cities we have vision of.
var map = [];

/* Returns a new array created by patching the diff into the old array.
 * The diff formatted with alternating matching and mismatching segments:
 * <Number of matching elements>
 * <Number of mismatching elements>
 * <The mismatching elements>
 * ... repeated until the end of diff.
 * Example 1: patching a diff of [1, 1, 3] onto [0, 0] yields [0, 3].
 * Example 2: patching a diff of [0, 1, 2, 1] onto [0, 0] yields [2, 0].
 */
function patch(old, diff) {
    var out = [];
    var i = 0;
    while (i < diff.length) {
        if (diff[i]) {  // matching
            Array.prototype.push.apply(out, old.slice(out.length, out.length + diff[i]));
        }
        i++;
        if (i < diff.length && diff[i]) {  // mismatching
            Array.prototype.push.apply(out, diff.slice(i + 1, i + 1 + diff[i]));
            i += diff[i];
        }
        i++;
    }
    return out;
}

socket.on('game_start', function(data) {
    // Get ready to start playing the game.
    playerIndex = data.playerIndex;
    var replay_url = 'http://bot.generals.io/replays/' + encodeURIComponent(data.replay_id);
    console.log('Game starting! The replay will be available after the game at ' + replay_url);
});

var time = 0;
var dx = [-1, 0, 1, 0];
var dy = [ 0, 1, 0,-1];

var first = 1;///spread as much as you can
var second = 0;///make a single big army and defend the general
var third = 0;///attack

var attackunit_row = -1;
var attackunit_col = -1;
var enemyunit_row = -1;
var enemyunit_col = -1;
var helper_row = -1;
var helper_col = -1;

socket.on('game_update', function(data) {
 
    function point_to(x,y,height,width){
        return x * width + y;
    }    
    function to_point(index,height,width){
        var out = new Array(2);
        out[0] = Math.floor(index / width);
        out[1] = Math.floor(index % width);
        return out;
    }

    function dist(xu,yu,xd,yd,ground,points,height,width){///get path from [xu,yu] to [xd,yd] with bfs
        var distance = new Array(height);
        for(var i = 0; i < height; ++i){
            distance[i] = new Array(width);
        }
        for(var i = 0; i < height; ++i){
            for(var j = 0; j < width; ++j){
                distance[i][j] = 0;
            }
        }
        var queuex = [];
        var queuey = [];
        var first = 0;
        var last = 0;
        distance[xu][yu] = 1;
        queuex[first] = xu; queuey[first] = yu;

        while(first <= last){
            var px = queuex[first];
            var py = queuey[first];
            first++;
            for(var i = 0; i < 4; ++i){
                var vx = px + dx[i];
                var vy = py + dy[i];
                if(vx >= 0 && vx < height && vy >= 0 && vy < width){
                    if(ground[vx][vy] != -2 && ground[vx][vy] != -4 && distance[vx][vy] == 0 && 
                        (points[vx][vy] <= 30 || ground[vx][vy] == playerIndex)){///city has 40+ pts 
                        distance[vx][vy] = distance[px][py] + 1;
                        queuex[++last] = vx;
                        queuey[last] = vy;
                    }
                }
            }
        }
        if(distance[xd][yd] == 0)
            return 0;
        var out = new Array(distance[xd][yd] * 2);
        
        var out_len = 0;
        while(xd != xu || yd != yu){
            out[out_len++] = xd;
            out[out_len++] = yd;
            
            for(var i = 0; i < 4; ++i){
                var vx = xd + dx[i];
                var vy = yd + dy[i];
                if(vx >= 0 && vx < height && vy >= 0 && vy < width){
                    if(distance[vx][vy] + 1 == distance[xd][yd]){
                        xd = vx;
                        yd = vy;
                        break;
                    }
                }
            }
        }
        out[out_len++] = xu;
        out[out_len++] = yu;
        return out;
    }
    
    function try_first(time,height,width,ground,points,general_row,general_col){
        if(time == 16){///spread with 8 NV first time
            var finish = 0;
            for(var i = 0; i < height && finish == 0; ++i){
                for(var j = 0; j < width && finish == 0; ++j){
                    var path = dist(general_row,general_col,i,j,ground,points,height,width);
                    if(path.length / 2 == 9){
                        for(var k = path.length - 1; k >= 3; k -= 2){
                            socket.emit('attack',point_to(path[k - 1],path[k],height,width),
                                                 point_to(path[k - 3],path[k - 2],height,width)); 
                        }
                        finish = 1;
                    }
                }
            }   
        }
        if(time == 32){///spread with 8 SE second time
            var finish = 0;
            for(var i = height - 1; i >= 0 && finish == 0; --i){
                for(var j = width - 1; j >= 0 && finish == 0; --j){
                    var path = dist(general_row,general_col,i,j,ground,points,height,width);
                    if(path.length / 2 == 9){
                        for(var k = path.length - 1; k >= 3; k -= 2){
                            socket.emit('attack',point_to(path[k - 1],path[k],height,width),
                                                 point_to(path[k - 3],path[k - 2],height,width)); 
                        }
                        finish = 1;
                    }
                }
            } 
        }
        if(time == 46){///spread with 7 SV third time
            var finish = 0;
            for(var j = 0; j < width && finish == 0; ++j){
                for(var i = height - 1; i >= 0 && finish == 0; --i){
                    var path = dist(general_row,general_col,i,j,ground,points,height,width);
                    if(path.length / 2 == 9){
                        for(var k = path.length - 1; k >= 3; k -= 2){
                            socket.emit('attack',point_to(path[k - 1],path[k],height,width),
                                                 point_to(path[k - 3],path[k - 2],height,width)); 
                        }
                        finish = 1;
                    }
                }
            } 
        } 
    }
    
    function try_second(time,height,width,ground,points,general_row,general_col){//spread with maximum
        if(second){///points >= 2 random spreading
            var finish = 0;
            for(var i = 0; i < height && finish == 0; ++i){
                for(var j = 0; j < width && finish == 0; ++j){
                    if(points[i][j] > 1 && ground[i][j] == playerIndex){
                        for(var k = 0; k < 4; ++k){
                            var vx = i + dx[k];
                            var vy = j + dy[k];
                            if(vx >= 0 && vy >= 0 && vx < height && vy < width){
                                if(points[vx][vy] == 0 && ground[vx][vy] == TILE_EMPTY){
                                    socket.emit('attack',point_to(i,j,height,width),
                                                         point_to(vx,vy,height,width));
                                    finish = 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }   
    
    function city(x,y,ground,points){
        if(ground[x][y] == TILE_EMPTY && points[x][y] > 0)
            return 1;
        return 0;
    }
    function mountain(x,y,ground,points){
        if(ground[x][y] == TILE_MOUNTAIN)
            return 1;
        return 0;
    }
    function call_helper(time,height,width,ground,points,general_row,general_col,playerIndex){
        if(helper_row == -1 && helper_col == -1){
            helper_row = general_row;
            helper_col = general_col;
        }else{
            var path1 = dist(attackunit_row,attackunit_col,helper_row,helper_col,ground,points,height,width);
         
            for(var i = 0; i < 4; ++i){
                var vx = helper_row + dx[i];
                var vy = helper_col + dy[i];
                if(vx >= 0 && vy >= 0 && vx < height && vy < width){ 
                    var path = dist(vx,vy,attackunit_row,attackunit_col,ground,points,height,width);
                
                    if(path.length < path1.length){
                        if(!mountain(vx,vy,ground,points) && 
                            !city(vx,vy,ground,points)){
                            socket.emit('attack',point_to(helper_row,helper_col,height,width),
                                              point_to(vx,vy,height,width));
                            helper_row = vx;
                            helper_col = vy;
                            break;
                        }
                    }
                }
            }
            if(helper_row == attackunit_row && helper_col == attackunit_col){
                helper_row = -1;
                helper_col = -1;
            }
        }
    }
    function try_third(time,height,width,ground,points,general_row,general_col,playerIndex){
        var mx_points = 0, mx_row = 0, mx_col = 0,enemylin = 0,enemycol = 0;
        
        if(attackunit_row != -1 && attackunit_col != -1){
            if(points[attackunit_row][attackunit_col] < 40){
                call_helper(time,height,width,ground,points,general_row,general_col,playerIndex);
                return;
            }else{
                helper_row = -1;
                helper_col = -1;
            }
        }
        for(var i = 0; i < height; ++i){
            for(var j = 0; j < width; ++j){
                if(ground[i][j] >= 0 && ground[i][j] != playerIndex){
                    enemylin = i;
                    enemycol = j;
                }
                if(points[i][j] > mx_points && ground[i][j] == playerIndex){
                    mx_points = points[i][j];
                    mx_row = i;
                    mx_col = j;
                }
            }
        }
        if(attackunit_row == -1 && attackunit_col == -1){
            attackunit_row = mx_row;
            attackunit_col = mx_col;
        }
        if(enemyunit_row == -1 && enemyunit_col == -1){
            enemyunit_row = enemylin;
            enemyunit_col = enemycol;
        }

        var path1 = dist(attackunit_row,attackunit_col,enemyunit_row,enemyunit_col,ground,points,height,width);

         
        for(var i = 0; i < 4; ++i){
            var vx = attackunit_row + dx[i];
            var vy = attackunit_col + dy[i];
            if(vx >= 0 && vy >= 0 && vx < height && vy < width){ 
                var path = dist(vx,vy,enemyunit_row,enemyunit_col,ground,points,height,width);
                
                if(path.length < path1.length){
                    if(!city(vx,vy,ground,points) && !mountain(vx,vy,ground,points)){
                        socket.emit('attack',point_to(attackunit_row,attackunit_col,height,width),
                                             point_to(vx,vy,height,width));
                        attackunit_row = vx;
                        attackunit_col = vy;
                        break;
                    }
                }
            }
        }
       
        if(enemyunit_row == attackunit_row && enemyunit_col == attackunit_col){///REGROUP and ATTACK    
            enemyunit_row = -1;
            enemyunit_col = -1;
        }   
    }
    
    // Patch the city and map diffs into our local variables.
    cities = patch(cities, data.cities_diff);
    map = patch(map, data.map_diff);
    generals = data.generals;
    
    // The first two terms in |map| are the dimensions.
    var width = map[0];
    var height = map[1];
    var size = width * height;

    // The next |size| terms are army values.
    // armies[0] is the top-left corner of the map.
    var armies = map.slice(2, size + 2);

    // The last |size| terms are terrain values.
    // terrain[0] is the top-left corner of the map.
    var terrain = map.slice(size + 2, size + 2 + size);
    
    //move
    time++;
 
    var ground = new Array(height);
    var points = new Array(height);
    for(var i = 0; i < ground.length; ++i){
        ground[i] = new Array(width);
        points[i] = new Array(width);
    }
    var mx = 0,mx_row = 0, mx_lin = 0;
    var curr_index = 0;
    for(var i = 0; i < height; ++i){
        for(var j = 0; j < width; ++j){
            ground[i][j] = terrain[curr_index];
            points[i][j] = armies[curr_index++];
            
            if(ground[i][j] >= 0 && ground[i][j] != playerIndex){
                first = 0; second = 0; third = 1;
            }            
        }
    }
    var general_row = Math.floor(generals[playerIndex] / width);
    var general_col = Math.floor(generals[playerIndex] % width);
    
    if(time > 60 && third == 0){
        first = 0; second = 1; third = 0;
    }
      
    if(first){
        try_first(time,height,width,ground,points,general_row,general_col);  
    }else
    if(second){
        try_second(time,height,width,ground,points,general_row,general_col);    
    }else
    if(third){
        try_third(time,height,width,ground,points,general_row,general_col,playerIndex);
    }else
    if(fourth){

    }        
});

function leaveGame() {
    socket.emit('leave_game');
}

socket.on('game_lost', leaveGame);

socket.on('game_won', leaveGame);

const Cognito = require('amazon-cognito-identity-js');
const AWS = require('aws-sdk');
const poolData = {
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    ClientId: process.env.COGNITO_CLIENT_ID
};

const getUser = (username) => {
    const userPool = new Cognito.CognitoUserPool(poolData);
    const userData = {
        Username: username,
        Pool: userPool
    };

    return new Cognito.CognitoUser(userData);
};

const confirmResetPassword = ({email, password, code}) => new Promise((resolve, reject) => {
    if (!email || !password || !code) {
        console.log('missing email, password or code');
        reject();
    }
    console.log('confirming reset for email ' + email);
    findUserByEmail(email).then(results => {
        if (results.Users.length > 0) {
            if (results.Users.length != 1) {
                console.log(`Somehow found multiple users for email ${email}`);
                reject();
            } else {
                const username = results.Users[0].Username;
                console.log('found username for reset password ' + username);
         
                const params = {
                    ClientId: process.env.COGNITO_CLIENT_ID,
                    ConfirmationCode: code,
                    Password: password,
                    Username: username
                };
                
                const provider = new AWS.CognitoIdentityServiceProvider({region: process.env.awsRegion});
            
                provider.confirmForgotPassword(params, (err, data) => {
                    console.log('confirm forgot response');
                    console.log(err);
                    console.log(data);
                    if (err) {
                        reject({success: false});
                    } else {
                        resolve({success: true});
                    }
                });
            }
        }
    });
});

const sendResetPasswordRequest = (username) => new Promise((resolve, reject) => {
    const params = {
        ClientId: process.env.COGNITO_CLIENT_ID,
        Username: username
    };

    const provider = new AWS.CognitoIdentityServiceProvider({region: process.env.awsRegion});

    provider.forgotPassword(params, (err, data) => {
        console.log('user ' + username + ' forgot password');
        console.log(err);
        console.log(data);
        resolve();
    });
});

const resetPassword = (payload) => new Promise((resolve, reject) => {
    if(!payload.email) {
        reject();
    } else {
        resolve();

        findUserByEmail(payload.email).then((results) => {
            console.log("found that user by email " + payload.email);
            if (results.Users.length > 0) {
                if (results.Users.length != 1) {
                    console.log(`Somehow found multiple users for email ${payload.email}`);
                } else {
                    const username = results.Users[0].Username;
                    sendResetPasswordRequest(username);
                }
            }
            console.log(user);
        }).catch(() => {
        });
    }
});

const findUserByUsername = (username) => new Promise((resolve, reject) => {
    const params = {
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Filter: `username = "${username}"`
    };

    const provider = new AWS.CognitoIdentityServiceProvider({region: process.env.awsRegion});

    provider.listUsers(params, (err, data) => {
        if (err) {
            reject(err);
        } 

        resolve(data);
    });

});

const getCognitoUser = (username) => new Promise((resolve, reject) => {
    const params = {
        UserPoolId: poolData.UserPoolId,
        Username: username
    };

    const provider = new AWS.CognitoIdentityServiceProvider({region: 'us-west-2'});

    provider.adminGetUser(params, (err, data) => {
        resolve({
            created: data.UserCreateDate
        });
    });
});

const login = (payload) => new Promise((resolve, reject) => {

    const username = payload.username;
    const password = payload.password;

    const authDetails = new Cognito.AuthenticationDetails({
        Username: username,
        Password: password
    });

    const userPool = new Cognito.CognitoUserPool(poolData);

    const userData = {
        Username: username,
        Pool: userPool
    };

    const user = new Cognito.CognitoUser(userData);

    user.authenticateUser(authDetails, {
        onSuccess: (result) => {
            getCognitoUser(username).then((cognitoUser) => {
                resolve({
                    created: cognitoUser.created,
                    accessToken: result.getAccessToken().getJwtToken(),
                    idToken: result.getIdToken().getJwtToken(),
                    refreshToken: result.getRefreshToken().getToken()
                });
            });
        },
        onFailure: (err) => {
            reject(err);
        }
    });
});

const refresh = (payload) => new Promise((resolve, reject) => {
    const accessTokenVal = payload.accessToken;
    const refreshTokenVal = payload.refreshToken;
    const idTokenVal = payload.idToken;

    const AccessToken = new Cognito.CognitoAccessToken({ AccessToken: accessTokenVal });
    const RefreshToken = new Cognito.CognitoRefreshToken({ RefreshToken: refreshTokenVal });
    const IdToken = new Cognito.CognitoIdToken({ IdToken: idTokenVal });

    const sessionData = {
        IdToken,
        AccessToken,
        RefreshToken
    };

    const cachedSession = new Cognito.CognitoUserSession(sessionData);

    if (cachedSession.isValid()) {
        resolve({
            accessToken: cachedSession.getAccessToken().getJwtToken(),
            idToken: cachedSession.getIdToken().getJwtToken(),
            refreshToken: cachedSession.getRefreshToken().getToken()
        });

    } else {
        const user = getUser(payload.username);
        user.refreshSession(RefreshToken, (err, session) => {
            if (err) {
                console.log('couldnt refresh');
                console.log(err);
                reject(err);
            } else {
                resolve({
                    accessToken: session.getAccessToken().getJwtToken(),
                    idToken: session.getIdToken().getJwtToken(),
                    refreshToken: session.getRefreshToken().getToken()
                });
            }
        });
    }
});

const verify = (payload) => new Promise((resolve, reject) => {
    //todo: move this logic to this package
    const lambda = new AWS.Lambda({ region: process.env.awsRegion });

    const params = {
        FunctionName: 'decode-jwt',
        Payload: JSON.stringify({
            token: payload.accessToken
        })
    };

    lambda.invoke(params, (err, _data) => {
        if (!_data) {
            reject('Failed to decode token');
        } else if (_data.Payload === 'false') {
            reject('invalid access token');
        } else if (err) {
            reject(err);
        }

        const data = JSON.parse(_data.Payload);

        if (data.username === payload.username) {
            resolve({
                success: true
            });
        } else {
            reject('JWT username does not match provided username');
        }
    });

});

const findUserByEmail = (email) => new Promise((resolve, reject) => {
    const params = {
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Filter: `email = "${email}"`
    };

    const provider = new AWS.CognitoIdentityServiceProvider({region: process.env.awsRegion});

    provider.listUsers(params, (err, data) => {
        if (err) {
            reject(err);
        } 

        resolve(data);
    });
});

const signUp = (payload) => new Promise((resolve, reject) => {
    if (!payload.username || !payload.email || !payload.password) {
        reject('Signup requires username, email & password');
    }
    findUserByEmail(payload.email).then(userData => {
        if (userData.Users && userData.Users.length > 0) {
            reject("User with that email already exists");
        } else {
            const attributeList = [
                new Cognito.CognitoUserAttribute(
                    {Name: 'email', Value: payload.email},
                    {Name: 'name', Value: payload.username}
                ),
            ];
            
            const userPool = new Cognito.CognitoUserPool(poolData);

            userPool.signUp(payload.username, payload.password, attributeList, null, (err, result) => {
                if (err) {
                    reject(err.message);
                } else {
                    resolve({
                        username: result.user.username
                    });
                }
            });
        }
    }); 
});

const confirmUser = (payload) => new Promise((resolve, reject) => {
   if (!payload.username || !payload.code) {
       reject('Confirmation requires username & code');
   }  else {
        const provider = new AWS.CognitoIdentityServiceProvider({region: process.env.awsRegion});
        const params = {
            ClientId: process.env.COGNITO_CLIENT_ID,
            ConfirmationCode: payload.code,
            Username: payload.username
        };
        
        provider.confirmSignUp(params, (err, data) => {
            const success = !err;
            console.log(err);
    
            resolve({
                success
            });
        });
   }
});

const inputHandlers = {
    login,
    refresh,
    verify,
    signUp,
    resetPassword,
    confirmResetPassword,
    confirmUser
};

exports.handler = (event, context, callback) => {

    if (inputHandlers[event.type]) {
        inputHandlers[event.type](event).then(response => {
            callback(null, response);
        }).catch(err => {
            callback(Error(err.message || err.toString()));
        });
    } else {
        callback('not found');
    }

};



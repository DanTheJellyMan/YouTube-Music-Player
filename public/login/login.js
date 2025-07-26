const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const REQUEST_TIMEOUT_SECONDS = 60;

/**
 * Handle login/sign up requests
 * @param {string} url Login/Sign up path
 */
async function account(url) {
    const username = usernameInput.value.trim().normalize("NFKC");
    const password = passwordInput.value.trim().normalize("NFKC");
    if (!validateInput(username, password)) return;
    console.log(JSON.stringify({ url, username, password }, null, 4));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("Timeout"), 1000*REQUEST_TIMEOUT_SECONDS);
    let res;
    try {
        res = await fetch(url, {
            "method": "POST",
            "headers": {
                "Content-Type": "application/json"
            },
            "body": JSON.stringify({ username, password }),
            "signal": controller.signal
        });
    } catch (err) {
        console.error(err);
        return alert(err);
    }
    clearTimeout(timeout);

    if (!res.ok) {
        alert(await res.text());
    } else {
        window.location = "/home";
    }
}

function validateInput(username, password) {
    const { sizeRegex: unameSizeRegex, charRegex: unameCharRegex } = getUsernameRequirements();
    const { sizeRegex: pwordSizeRegex, charRegex: pwordCharRegex } = getPasswordRequirements();

    const reasons = [];
    let ok = false;
    if (!unameSizeRegex.test(username)) {
        reasons.push(`Username length (${username.length}) must be between 3 and 100`);
    }
    if (!unameCharRegex.test(username)) {
        reasons.push(`Username may only contain the alphabet, numbers, or characters: _-.`);
    }
    if (!pwordSizeRegex.test(password)) {
        reasons.push(`Password length (${password.length}) must be between 3 and 200`);
    }
    if (!pwordCharRegex.test(password)) {
        reasons.push(`Password must contain valid characters`);
    }

    if (reasons.length === 0) {
        ok = true;
    } else {
        alert(reasons.join("\n"));
    }
    return ok;
}

function getUsernameRequirements() {
    return {
        "sizeRegex": /^.{3,100}$/g,
        "charRegex": /^[A-Za-z_\-.0-9]+$/g
    }
}
function getPasswordRequirements() {
    return {
        "sizeRegex": /^.{3,200}$/g,
        "charRegex": /^.+$/g
    }
}
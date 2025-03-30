let cachedVersion = null;
async function fetchVersion() {
  if (cachedVersion !== null) {
    return cachedVersion;
  }
  try {
    const response = await fetch('/dashboard/api/version');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    cachedVersion = {
      version: 'v' + (data.version || '0.0.1'),
      protocol_version: 'v' + (data.protocol_version || '0.0.1')
    };
    return cachedVersion;
  } catch (error) {
    console.error('Version fetch failed:', error);
    return { version: 'Error', protocol_version: 'Error' };
  }
}


function showConsoleEgg(serverVersion, protocolVersion) {
    console.log(`
    %c
      _____                               _   ____                            
     |  __ \\                             | | |  _ \\                           
     | |__) |____      _____ _ __ ___  __| | | |_) |_   _                     
     |  ___/ _ \\ \\ /\\ / / _ \\ '__/ _ \\/ _\` | |  _ <| | | |                    
     | |  | (_) \\ V  V /  __/ | |  __/ (_| | | |_) | |_| |                    
     |_|   \\___/ \\_/\\_/ \\___|_|  \\___|\\__,_| |____/ \\__, |                    
      _   _           _                              __/ |                    
     | \\ | |         | |                            |___/                     
     |  \\| | ___   __| | ___                                                  
     | . \` |/ _ \\ / _\` |/ _ \\                                                 
     | |\\  | (_) | (_| |  __/                                                 
     |_| \\_|\\___/ \\__,_|\\___|                                                 
       ____                   ____  __  __  _____ _               _____ _____ 
      / __ \\                 |  _ \\|  \\/  |/ ____| |        /\\   |  __ \\_   _|
     | |  | |_ __   ___ _ __ | |_) | \\  / | |    | |       /  \\  | |__) || |  
     | |  | | '_ \\ / _ \\ '_ \\|  _ <| |\\/| | |    | |      / /\\ \\ |  ___/ | |  
     | |__| | |_) |  __/ | | | |_) | |  | | |____| |____ / ____ \\| |    _| |_ 
      \\____/| .__/ \\___|_| |_|____/|_|  |_|\\_____|______/_/    \\_\\_|   |_____|
            | |                                                               
            |_|                                                               
      ______ _                                                                
     |  ____(_)                                                               
     | |__   ___  __                                                          
     |  __| | \\ \\/ /                                                          
     | |    | |>  <                                                           
     |_|    |_/_/\\_\\                                                          
                                                                              
                                                                              
    `, 'color: #68a063; font-family: monospace; font-size: 12px;');
    
    console.log(`%cNode OpenBMCLAPI Fix - Version: ${serverVersion}`, 'color: #3c873a; font-weight: bold;');
    console.log(`%cProtocol Version: ${protocolVersion}`, 'color: #3c873a;');
    console.log('%cPowered by Node.js', 'color: #8cc84b; font-style: italic;');
}

var notOpened = true;

document.addEventListener('keydown', async (e) => { 
  if (e.key === 'F12' && notOpened) {
    const versionData = await fetchVersion(); 
    showConsoleEgg(versionData.version, versionData.protocol_version);
    notOpened = false;
  }
});
import net from "node:net";

export function isPrivateRailwayIpv4(value){
  if(typeof value!=="string"||!net.isIPv4(value))return false;
  const [a,b]=value.split(".").map(Number);
  return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||
    (a===100&&b>=64&&b<=127);
}

export function selectSingleRailwayIpv4(results){
  if(!Array.isArray(results))throw new Error("Private Railway DNS lookup is invalid");
  const addresses=[...new Set(results
    .map(item=>typeof item==="string"?item:item?.address)
    .filter(address=>typeof address==="string"&&net.isIPv4(address)))];
  if(addresses.length!==1||!isPrivateRailwayIpv4(addresses[0])){
    throw new Error("Private Railway DNS must resolve to one private IPv4 address");
  }
  return addresses[0];
}

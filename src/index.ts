import app from "./app";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OAuthProvider from "@cloudflare/workers-oauth-provider";

// Type definitions
interface VoIPMonitorCall {
	ID?: string;
	id?: string;
	callid: string;
	caller: string;
	called: string;
	calldate: string;
	duration: number;
	lastSIPresponseNum: string;
	a_mos?: number;
	a_loss?: number;
	a_maxjitter?: number;
}

interface VoIPMonitorAuthResponse {
	success: boolean;
	SID: string;
	cookie_name: string;
}

interface VoIPMonitorSipHistoryMessage {
	time: number;
	src: string;
	dst: string;
	msg: string;
}

interface VoIPMonitorSipHistoryResponse {
	results?: VoIPMonitorSipHistoryMessage[];
}

interface EnvironmentBindings {
	VOIPMONITOR_URL: string;
	VOIPMONITOR_USER: string;
	VOIPMONITOR_PASSWORD: string;
}

export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "VoIPmonitor Support Assistant",
		version: "1.0.0",
	});

	private voipmonitorUrl!: string;
	private username!: string;
	private password!: string;
	private sessionId: string | null = null;
	private cookieName: string | null = null;
	
	// Override the env property to include our bindings
	declare protected env: EnvironmentBindings;

	async init(): Promise<void> {
		// Get credentials from environment
		this.voipmonitorUrl = this.env.VOIPMONITOR_URL;
		this.username = this.env.VOIPMONITOR_USER;
		this.password = this.env.VOIPMONITOR_PASSWORD;

		if (!this.voipmonitorUrl || !this.username || !this.password) {
			throw new Error('Missing VoIPmonitor credentials in environment variables');
		}

		// Register tools for support agents
		this.server.tool(
			"search_calls",
			{
				startTime: z.string().describe("Start time in YYYY-MM-DD or YYYY-MM-DD HH:MM:SS format"),
				endTime: z.string().optional().describe("End time in YYYY-MM-DD or YYYY-MM-DD HH:MM:SS format"),
				caller: z.string().optional().describe("Caller phone number"),
				called: z.string().optional().describe("Called phone number"),
				callId: z.string().optional().describe("SIP Call-ID header value"),
				onlyConnected: z.boolean().optional().describe("Return only connected calls (default: false)"),
				limit: z.number().optional().describe("Maximum number of results (default: 50)")
			},
			async (params) => {
				try {
					await this.authenticate();
					
					const apiParams: Record<string, unknown> = {
						startTime: params.startTime,
					};

					if (params.endTime) apiParams.endTime = params.endTime;
					if (params.caller) apiParams.caller = params.caller;
					if (params.called) apiParams.called = params.called;
					if (params.callId) apiParams.callId = params.callId;
					if (params.onlyConnected !== undefined) apiParams.onlyConnected = params.onlyConnected ? 1 : 0;

					const result = await this.makeApiCall('getVoipCalls', apiParams);
					
					// Format results for support agents
					const calls: VoIPMonitorCall[] = result;
					const formattedCalls = calls.slice(0, params.limit || 50).map(call => ({
						cdrId: call.ID || call.id || 'unknown',
						callId: call.callid,
						caller: call.caller,
						called: call.called,
						callDate: call.calldate,
						duration: call.duration,
						sipResponse: call.lastSIPresponseNum,
						quality: {
							mos: call.a_mos,
							loss: call.a_loss,
							jitter: call.a_maxjitter
						}
					}));

					return {
						content: [
							{
								type: "text" as const,
								text: `Found ${formattedCalls.length} calls:\n\n${formattedCalls.map(call => 
									`📞 Call ${call.cdrId}\n` +
									`  From: ${call.caller} → To: ${call.called}\n` +
									`  Date: ${call.callDate}\n` +
									`  Duration: ${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}\n` +
									`  Status: ${call.sipResponse}\n` +
									`  Quality: MOS ${call.quality.mos || 'N/A'}, Loss ${call.quality.loss || 0}%\n`
								).join('\n')}`
							}
						]
					};
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					return {
						content: [
							{
								type: "text" as const,
								text: `Error searching calls: ${errorMessage}`
							}
						]
					};
				}
			}
		);

		this.server.tool(
			"get_call_details",
			{
				cdrId: z.string().describe("CDR ID of the call")
			},
			async (params) => {
				try {
					await this.authenticate();
					
					const searchResult = await this.makeApiCall('getVoipCalls', {
						cdrId: params.cdrId
					});

					if (!searchResult || searchResult.length === 0) {
						return {
							content: [
								{
									type: "text" as const,
									text: `Call with CDR ID ${params.cdrId} not found.`
								}
							]
						};
					}

					const call = searchResult[0];
					
					// Get SIP history
					let sipHistory: VoIPMonitorSipHistoryMessage[] | null = null;
					try {
						const historyResponse = await fetch(`${this.voipmonitorUrl}/php/pcap2text.php?action=brief_data&id=${params.cdrId}`, {
							headers: {
								'Cookie': `${this.cookieName}=${this.sessionId}`
							}
						});
						if (historyResponse.ok) {
							const historyData: VoIPMonitorSipHistoryResponse = await historyResponse.json();
							sipHistory = historyData.results || null;
						}
					} catch (error) {
						console.warn('Could not fetch SIP history:', error);
					}

					let response = `📋 **Call Details for CDR ${params.cdrId}**\n\n`;
					response += `Call ID: ${call.callid}\n`;
					response += `From: ${call.caller} → To: ${call.called}\n`;
					response += `Date: ${call.calldate}\n`;
					response += `Duration: ${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}\n`;
					response += `SIP Response: ${call.lastSIPresponseNum}\n`;
					response += `Quality: MOS ${call.a_mos || 'N/A'}, Loss ${call.a_loss || 0}%, Jitter ${call.a_maxjitter || 0}ms\n`;

					if (sipHistory && sipHistory.length > 0) {
						response += `\n**SIP Message History:**\n`;
						sipHistory.slice(0, 10).forEach(msg => {
							response += `${msg.time}s: ${msg.src} → ${msg.dst} | ${msg.msg}\n`;
						});
					}

					return {
						content: [
							{
								type: "text" as const,
								text: response
							}
						]
					};
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					return {
						content: [
							{
								type: "text" as const,
								text: `Error getting call details: ${errorMessage}`
							}
						]
					};
				}
			}
		);

		this.server.tool(
			"get_pcap_info",
			{
				cdrId: z.string().describe("CDR ID of the call"),
				includeRtp: z.boolean().optional().describe("Include RTP data in PCAP (default: true)")
			},
			async (params) => {
				try {
					await this.authenticate();
					
					const includeRtp = params.includeRtp !== false;
					const pcapUrl = `${this.voipmonitorUrl}/php/pcap.php?id=${params.cdrId}${includeRtp ? '' : '&disable_rtp=1'}`;
					
					return {
						content: [
							{
								type: "text" as const,
								text: `🔍 **PCAP Information for Call ${params.cdrId}**\n\n` +
								`PCAP Download URL: ${pcapUrl}\n` +
								`Includes RTP: ${includeRtp ? 'Yes' : 'No'}\n\n` +
								`You can download this PCAP file for detailed network analysis using tools like Wireshark.`
							}
						]
					};
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					return {
						content: [
							{
								type: "text" as const,
								text: `Error getting PCAP info: ${errorMessage}`
							}
						]
					};
				}
			}
		);

		this.server.tool(
			"search_problem_calls",
			{
				issueType: z.enum(["disconnections", "quality", "failed_calls"]).describe("Type of issue to search for"),
				timeRange: z.string().describe("Time range like '1h', '2h', 'today', or specific date"),
				limit: z.number().optional().describe("Maximum number of results (default: 20)")
			},
			async (params) => {
				try {
					await this.authenticate();
					
					// Convert time range to start/end times
					let startTime: string;
					const endTime: string = new Date().toISOString().slice(0, 19).replace('T', ' ');
					
					if (params.timeRange === 'today') {
						startTime = new Date().toISOString().slice(0, 10) + ' 00:00:00';
					} else if (params.timeRange.endsWith('h')) {
						const hours = parseInt(params.timeRange);
						const start = new Date(Date.now() - hours * 60 * 60 * 1000);
						startTime = start.toISOString().slice(0, 19).replace('T', ' ');
					} else {
						startTime = params.timeRange;
					}

					const apiParams: Record<string, unknown> = {
						startTime,
						endTime
					};

					// Add filters based on issue type
					switch (params.issueType) {
						case 'disconnections':
							apiParams.fbye = false; // Calls that didn't end properly
							break;
						case 'quality':
							// Look for calls with poor quality indicators
							apiParams.fmosf1 = '0'; // MOS less than threshold
							apiParams.floss1 = '5'; // Loss greater than 5%
							break;
						case 'failed_calls':
							apiParams.fsipresponse = '4'; // 4xx and 5xx responses
							break;
					}

					const result = await this.makeApiCall('getVoipCalls', apiParams);
					const calls: VoIPMonitorCall[] = result;
					const limitedCalls = calls.slice(0, params.limit || 20);

					let response = `🚨 **${params.issueType.replace('_', ' ').toUpperCase()} in ${params.timeRange}**\n\n`;
					response += `Found ${limitedCalls.length} problem calls:\n\n`;

					limitedCalls.forEach(call => {
						response += `📞 Call ${call.ID || call.id || 'unknown'}\n`;
						response += `  From: ${call.caller} → To: ${call.called}\n`;
						response += `  Date: ${call.calldate}\n`;
						response += `  Issue: ${this.getIssueDescription(call, params.issueType)}\n\n`;
					});

					return {
						content: [
							{
								type: "text" as const,
								text: response
							}
						]
					};
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					return {
						content: [
							{
								type: "text" as const,
								text: `Error searching problem calls: ${errorMessage}`
							}
						]
					};
				}
			}
		);
	}

	private async authenticate(): Promise<void> {
		if (this.sessionId) return;

		const authUrl = `${this.voipmonitorUrl}/php/model/sql.php?module=bypass_login&user=${this.username}&pass=${this.password}`;
		
		const response = await fetch(authUrl, { method: 'POST' });
		
		if (!response.ok) {
			throw new Error(`Authentication failed: ${response.status}`);
		}

		const auth = await response.json() as VoIPMonitorAuthResponse;
		
		if (auth.success) {
			this.sessionId = auth.SID;
			this.cookieName = auth.cookie_name;
		} else {
			throw new Error('Authentication failed: Invalid credentials');
		}
	}

	private async makeApiCall(task: string, params: Record<string, unknown>): Promise<VoIPMonitorCall[]> {
		const response = await fetch(`${this.voipmonitorUrl}/php/api.php`, {
			method: 'POST',
			headers: {
				'Cookie': `${this.cookieName}=${this.sessionId}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				task,
				user: this.username,
				password: this.password,
				params
			})
		});

		if (!response.ok) {
			throw new Error(`API call failed: ${response.status}`);
		}

		const result = await response.json() as VoIPMonitorCall[] | VoIPMonitorCall;
		return Array.isArray(result) ? result : [result];
	}

	private getIssueDescription(call: VoIPMonitorCall, issueType: string): string {
		switch (issueType) {
			case 'disconnections':
				return `Call disconnected unexpectedly (Duration: ${call.duration}s)`;
			case 'quality':
				return `Poor quality - MOS: ${call.a_mos || 'N/A'}, Loss: ${call.a_loss || 0}%`;
			case 'failed_calls':
				return `Call failed with SIP ${call.lastSIPresponseNum}`;
			default:
				return 'Unknown issue';
		}
	}
}

// Export the OAuth handler as the default
export default new OAuthProvider({
	apiRoute: "/sse",
	// @ts-expect-error
	apiHandler: MyMCP.mount("/sse"),
	// @ts-expect-error
	defaultHandler: app,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
});
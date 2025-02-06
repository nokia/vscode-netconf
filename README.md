# NETCONF for Visual Studio Code

## About

This vsCode extension implements an interactive NETCONF client, that runs
against NETCONF servers, like NOKIA IP Routers powered by SR OS and SRLinux.
By integrating NETCONF with Visual Studio Code, users will be able to extend
the industry leading open-source code editor and integrated development
environment by the ability to communicate with latest networking equipment
using the NETCONF protocol.

The extension is implemented in native JavaScript/TypeScript and works
on your desktop system of choice (Windows, macOS, Linux).

## Build

To build this extension, you can use the Visual Studio Code Extensions
command-line tool called 
[vsce](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).


```bash
$ git clone https://github.com/nokia/vscode-netconf
$ cd vscode-netconf
$ npm install .
$ vsce package
```

## Contributions

We are happy to have people contributing to this project. If you have feature
request or if you want to report misfunctions, feel free to raise
[Issues](https://github.com/nokia/netconf-examples/issues).

If you want to contribute code-changes, you can contribute directly via
normal pull-request procedure.

## Getting Started!

Netconf server settings are persisted as part of the extension settings.
For common cases like adding or deleting server entries, open the
NETCONF view from the activity bar and you will have direct access to
the server and connection list.

If you require advanced settings, like persisting the server passwords
or adjusting the client capabilities, you will find those options as
part of the extension settings.

## Supported Features

* **Support for NETCONF over SSHv2**

  [RFC 6241](https://tools.ietf.org/html/rfc6241) and
  [RFC 6242](https://tools.ietf.org/html/rfc6242) compliant NETCONF client,
  fully integrated with Visual Studio Code. Both **end-of-message framing*
  and *chunked-framing* (base:1.0 and base:1.1) are supported.
  
* **Authentication support: username/password and key-based**

* **Connection control**

  The user has control when to connect/disconnect to the NETCONF server.
  All RPC request are send over the same NETCONF session as long the user is
  connected. This allows execute complex flows like `lock` > `edit-config` >
  `validate` > `confirmed-commit` > `confirm` > `unlock`.
  It's also an enabler to receive event notifications.

* **Support for NETCONF event notifications**

  The `vscode-netconf` extension is
  [RFC 5277](https://tools.ietf.org/html/rfc6241) compliant to receive
  NETCONF event notifications. Events will be buffered and while the
  status-bar shows the number of received events. By clicking on the
  events icon in the status-bar, a new TextDocument containing the
  buffered notifications will be opened and the buffer gets cleared.

* **Examples library**

  NETCONF request examples are available from
  https://github.com/nokia/netconf-examples and can be added to the `vscode`
  workspace.

  By default, the example library will be cloned to the users home directory.
  You can set the `git.defaultCloneDirectory` in the Visual Studio Code
  settings to an alternative folder like "~/Development" based on your
  personal needs.

* **Access to server SSH greetings, SSH banner**

* **Access to NETCONF `<hello/>` messages**

* **Option: Prettify XML**

  From the extension settings it is possible to activate the
  `NETCONF: prettify` option. This is useful, when NETCONF servers return
  minified XML.

* **Option: SSH debug**

  To troubleshoot SSHv2 related issues, like handshake problems around
  ciphers, and key-exchange algorithms, SSH debugging can be enabled.
  To check the logs, use the console-view part of `Developer tools`
  (accessible from `Help`).

## Compatibility

Following vendors and device families have been tested so far:

| Vendor | Product Family | Router OS |
|---|---|---|
| Ciena | 5000 series | SAOS 10.9 |
| Cisco | NCS 540 series | IOS-XR 7.9.1 |
| Ericsson | 6000 series | IPOS 23.1 |
| Huawei | NetEngine 8000 series | rel 8.22/1 |
| Juniper | MX series | JunOS 22.4R1 |
| Nokia | SR families | SR OS |
| Nokia | SRL families | SR Linux |

We don't mind to get access to 3rd party equipment (preferred virtual
router/simulator images as virtual-machine or docker), test licenses and
some basic instructions to extend the scope of our testing, improve
compatibility and extend the capabilities.

## Known issues

* NETCONF responses are opened as new `TextDocument`. Visual Studio Code is
  automatically setting the `isDirty` tag, while you can't simple close the
  document as the `Save As` dialogue will always show up.

  Related to vscode-issue [#154664](https://github.com/microsoft/vscode/issues/154664).

* NETCONF responses will open as `Untitled TextDocument`. It's not possible
  to provide meaningful tab-names. Ideally, we would pre-define a file://
  location, that it could be saved by simply doing CTRL-S / CMD-S without
  `Save As` popup.

  Related to vscode-issue [#41909](https://github.com/microsoft/vscode/issues/41909).

* The vscode-netconf extension uses the API methods `showInformationMessage()`,
  `showWarningMessage()`, and `showErrorMessage()`. Messages are displayed as plain
  text without differentiation between message title and details and there is no
  possibility to show preformatted text and enforce line-breaks. In consequence,
  SSH banners are not displayed very nicely.

* Under rare conditions, NETCONF-over-SSH session death is not properly propagated.
  SSH-level keepalive mechanism can be activated to improve session health checks.
  If for whatever reason the underlying session died but extension state including
  status-bar was not updated, you can execute `Developer: Reload Window` from the
  Visual Studio command-palette. This will enforce the restart all extensions and
  fixes the issue.

## Feature candidates

We've captured the following feature candidates for future evolution:

* **Add Host Key Validation**

  By default, the [ssh2 library](https://github.com/mscdex/ssh2) automatically
  accepts any server-key. In secure environments it can be desired to
  implement the `hostVerifier` callback function, to identify the server
  host blocking potential man-in-the-middle attacks. The ask would be, to use
  the `~/.ssh/known_hosts` file for validation.

  In the case the node is unknown or the host-key has changed, a pop-up
  dialogue would inform the user allowing to accept the new key and to update the
  `known_hosts` or to block the connection.

* **Device Information**

  Capturing device-level information and display to the user (Vendor, Device
  Family, Chassis Type, Release, CPU, Memory, Temperature, Power Consumption,
  Ports/Interfaces, LLDP Neighbors).

* **Telemetry Support**

  Add extension telemetry to collect information about how `vscode-netconf` is
  used. This is to provide better visibility about the number of active users
  and how this extension is used. We are planning to publish some trending
  regarding vendors/device-families, the industry support of IETF NETCONF
  features and standard YANG models (IETF, OpenConfig). In addition, we
  would use telemetry to improve error-handling and compatibility issues.

* **Make extension YANG-aware**

  Use the same concept as [pysros](https://github.com/nokia/pysros) to build
  a local YANG library, based on the model-set that is supported by the
  NETCONF server.

  Following advanced features to be supported:
  - Display model-path / xpath from cursor position
  - Model-aware conversion between XML and JSON
  - Model-aware compare between two model-instances
  - Build a edit-config request from a get-config response
  - Table-editor for YANG lists
  - Run xpath queries
  - Advanced edition using IntelliSense:
    Error detection, Auto-completion, Suggests, Help on Hover

* **Integrated Diff**

  Graphical compare of running vs candidate datastores.

* **Password Storage**

  Store device passwords using vsCode secrets.

* **Connection Profiles**

  Avoid to enter the same set of connection properties over and over again.
  Instead, inherit settings from profiles, centrally being managed.

* **Logging improvements**

  Create dedicated logs per session-id.
  Housekeeping for old output channels w/o reloading vsCode windows (dispose).

* **Refactor: ConnectionFactory**

  Decoupling WebUI implementation (NetconfConnectionProvider, NetconfConnectionEntry) from
  actual netconf connections. Ensure that only active/running sessions are displayed in
  the WebUI.


Contributions are welcome, to help improving the usability of `vscode-netconf`.

## Changes
### Release 1.1.0

- Client capabilities are now configurable in the `netconf.serverList`.
  By default, `vscode-netconf` is sending the `base:1.0` and `base:1.1`
  capabilities to the server. By making the capabilities configurable,
  the desired framing mechanism can be enforced. In addition, it is
  possible to enable device-level feature like private candidates in
  Nokia SR OS.
- The execution time for RPCs is now captured and shown to the user.
  This is to get some initial idea on performance for a given
  `edit-config` or `commit` RPC. It is targeted for integrators
  to optimize the communication to the server and to implement
  response time-outs.

  The execution time is only shown to RPCs that return a simple
  `</ok>` as part of the confirmation dialogue. It's not available
  for RPCs that return detailed responses like `<get>`, `<get-config`.
  For those cases, it is shown in the console-log only.

### Release 1.2.0
- Improved logging using a dedicated vsCode OUTPUT channel called `netconf`.
- Support for vsCode REMOTE SSH in case you don't have direct connectivity
  to your network devices. Use `Remote SSH` to connect to your SSH jumphost,
  and install this NETCONF extension using vsCode on the remote host.
  When using containerized environments most propably the host running
  containerlab is your SSH target.

### Release 1.2.1
- Improved error-handling for Ciena supporting XML tags to fix:
  https://github.com/nokia/vscode-netconf/issues/2

### Release 2.0.0
- New user-interface: NETCONF view (check activity bar/side bar)
  Note: Old UI is not longer available
- Allow multiple concurrent connections to multiple servers
  Note: Dedicated OUTPUT channels are used per server
- Adhoc NETCONF connections from containerlab extension
- Ask user for password, if authentication has failed

### Release 2.1.0
- Use hostname for containerlab (instead of IP)
- Names for output channels (logging) using id (instead of hostname/IP)
- Provide password for new connections
- Taxonomy consistency: managed devices
- Connections are displayed with session-id
- Option to clone managed device entries
- Various error-handling improvements
- Update entries w/ cross-navigation to settings json

## License

This project is licensed under the BSD 3-Clause license - see the
[LICENSE](https://github.com/nokia/vscode-netconf/blob/master/LICENSE).

**Copyright (c) 2025 NOKIA**
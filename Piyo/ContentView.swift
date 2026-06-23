import SwiftUI

struct ContentView: View {
    @State private var selection: SidebarItem? = .terminal

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(SidebarItem.allCases) { item in
                    Label(item.title, systemImage: item.systemImage)
                        .tag(item)
                }
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 320)
            .navigationTitle("piyo")
        } detail: {
            if let selection {
                switch selection {
                case .terminal:
                    TerminalPane()
                default:
                    DetailView(item: selection)
                }
            } else {
                ContentUnavailableView(
                    "Nothing Selected",
                    systemImage: "sidebar.left",
                    description: Text("Pick an item from the sidebar.")
                )
            }
        }
        .frame(minWidth: 600, minHeight: 400)
    }
}

private struct DetailView: View {
    let item: SidebarItem

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: item.systemImage)
                .font(.system(size: 48))
                .foregroundStyle(.tint)
            Text(item.title)
                .font(.largeTitle)
                .fontWeight(.semibold)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle(item.title)
    }
}

#Preview {
    ContentView()
}

# Serves the interview and safety scripts from public/sondage under a path that
# changes whenever the files change: /sondage/v/<version>/historian.js. Their
# relative imports (./call.js and so on) pick up the same version, so a browser
# can never mix an old cached script with a new page.
class SondageScriptsController < ActionController::Base
  ROOT = Rails.root.join("public", "sondage").to_s.freeze

  def self.version
    files = Dir.glob(File.join(ROOT, "**", "*.js"))
    Digest::SHA256.hexdigest(files.sort.map { |f| "#{f}:#{File.mtime(f).to_f}" }.join("|"))[0, 12]
  end

  def show
    file = File.expand_path(params[:path].to_s, ROOT)
    return head :not_found unless file.start_with?(ROOT + "/") && file.end_with?(".js") && File.file?(file)
    response.headers["Cache-Control"] = params[:v] == self.class.version ? "public, max-age=31536000, immutable" : "no-cache"
    send_file file, type: "text/javascript", disposition: "inline"
  end
end
